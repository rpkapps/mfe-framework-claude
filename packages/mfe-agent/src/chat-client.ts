/**
 * The chat client: one conversation with an AG-UI backend.
 *
 * It follows TanStack AI's client (`ChatClient` in `@tanstack/ai-client`,
 * https://github.com/TanStack/ai): the same methods (`sendMessage`, `reload`, `stop`, `clear`,
 * `setMessages`), statuses and snapshot, so TanStack AI's documentation reads across. Only the API
 * is copied, not the code: underneath is the plain AG-UI client, which speaks the spec both ways and
 * works against any AG-UI backend, where TanStack AI's client works only against its own
 * (docs/decisions.md §49). Where this differs from TanStack AI, the README says why.
 *
 * One user turn is as many runs as it takes. A run that stops on the page's tools is answered by
 * running them and continued; a run that stops on an interrupt is shown to the user as one and
 * resumed with the answer. History is kept as AG-UI messages; `messages` is the view of it.
 */

import { HttpAgent } from '@ag-ui/client'
import type { Context, Interrupt, Message, ResumeEntry, Tool, ToolCall } from '@ag-ui/core'

import type { ChatConnection } from './connection.ts'
import { toUIMessages, type ToolCallProgress } from './message-view.ts'
import type {
  ApprovalQuestion,
  ChatClientOptions,
  ChatClientState,
  ChatInterrupt,
  ChatSnapshot,
  ChatTool,
  SendMessageOptions,
  ToolExecutionContext,
  UIMessage,
} from './types.ts'

const DEFAULT_MAX_RUNS_PER_TURN = 12

/** What the agent is told of a call the user stopped the turn before it ran. */
const STOPPED = 'The user stopped the turn before this tool ran.'

type Finished =
  | { readonly outcome: 'success'; readonly runId: string; readonly pending: readonly string[] }
  | {
      readonly outcome: 'interrupt'
      readonly runId: string
      readonly interrupts: readonly Interrupt[]
    }
  | { readonly outcome: 'cancelled'; readonly runId: string }

/** What a turn sends with each of its runs besides the history. */
interface TurnInput {
  readonly context: readonly Context[]
  readonly forwardedProps: Readonly<Record<string, unknown>> | undefined
}

/** What a run's page tools are told about it besides their own call. */
type RunInfo = Omit<ToolExecutionContext, 'toolCallId'>

/** Whether the agent carries on after this result: the tool's `followUp`, `true` by default. */
function followsUp(tool: ChatTool, result: unknown): boolean {
  const { followUp } = tool
  return typeof followUp === 'function' ? followUp(result) : followUp !== false
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function toWire(tool: ChatTool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema ?? { type: 'object', properties: {} },
  }
}

function parseArguments(call: ToolCall): { readonly input: unknown } | { readonly error: string } {
  const text = call.function.arguments.trim()
  if (text === '') return { input: {} }
  try {
    return { input: JSON.parse(text) as unknown }
  } catch {
    return { error: 'The arguments are not JSON.' }
  }
}

/** TanStack AI's `ChatClient`, on the plain AG-UI client; see the module comment. */
export class ChatClient {
  #options: ChatClientOptions
  readonly #agent: HttpAgent
  readonly #headers: ChatConnection['headers']
  readonly #unsubscribeAgent: () => void
  /** What the client has seen of each call in the history; pruned when the history is replaced. */
  readonly #progress = new Map<string, ToolCallProgress>()
  /**
   * The page tool running now, where a pipeline approval belongs. A turn runs its tools one at a
   * time and turns never overlap, so there is at most one.
   */
  #executing: { readonly name: string; readonly callId: string } | undefined
  readonly #listeners = new Set<() => void>()
  #interrupts: readonly ChatInterrupt[] = []
  /**
   * Answers to the backend's interrupts that a turn ended without sending, because a tool that
   * does not follow up gave them: the next run sends them.
   */
  #owed: readonly ResumeEntry[] = []
  #status: ChatClientState = 'ready'
  #error: Error | undefined
  #runId: string | null = null
  #lastRunId: string | undefined
  /** Bumped by `stop` and `clear`, so a turn in flight stops at its next step. */
  #generation = 0
  /** Aborted by `stop`, for the tools of the turn in flight. */
  #turnAbort = new AbortController()
  /** The last turn asked for. Each waits for the one before, so one run is in flight at a time. */
  #turn: Promise<void> = Promise.resolve()
  #approvals = 0
  #snapshot: ChatSnapshot

  constructor(options: ChatClientOptions) {
    this.#options = options
    const { connection } = options
    this.#headers = connection.headers
    this.#agent = new HttpAgent({
      url: connection.url,
      ...(connection.fetch === undefined ? {} : { fetch: connection.fetch }),
      ...(options.threadId === undefined ? {} : { threadId: options.threadId }),
      ...(options.initialMessages === undefined
        ? {}
        : { initialMessages: [...options.initialMessages] }),
    })

    // A resume names the run it continues: the spec allows it, and TanStack AI's backend needs it.
    this.#agent.use((input, next) =>
      next.run(
        input.resume === undefined || this.#lastRunId === undefined
          ? input
          : { ...input, parentRunId: this.#lastRunId },
      ),
    )

    const { unsubscribe } = this.#agent.subscribe({
      onRunStartedEvent: ({ event }) => {
        this.#runId = event.runId
        this.#status = 'streaming'
        this.#publish()
      },
      onToolCallStartEvent: ({ event }) => {
        this.#progress.set(event.toolCallId, { ended: false })
      },
      // Neither changes a message, so each publishes the call's new state itself.
      onToolCallEndEvent: ({ event }) => {
        this.#markEnded(event.toolCallId)
        this.#publish()
      },
      onRunFinishedEvent: ({ event }) => {
        this.#lastRunId = event.runId
        for (const id of this.#progress.keys()) this.#markEnded(id)
        this.#publish()
      },
      onMessagesChanged: () => {
        this.#publish()
      },
    })
    this.#unsubscribeAgent = unsubscribe
    this.#snapshot = this.#computeSnapshot()
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): ChatSnapshot => this.#snapshot

  getMessages(): readonly UIMessage[] {
    return this.#snapshot.messages
  }

  /** The conversation as it is stored: AG-UI messages. */
  getHistory(): readonly Message[] {
    return this.#agent.messages
  }

  getStatus(): ChatClientState {
    return this.#status
  }

  getIsLoading(): boolean {
    return this.#snapshot.isLoading
  }

  getError(): Error | undefined {
    return this.#error
  }

  getInterrupts(): readonly ChatInterrupt[] {
    return this.#interrupts
  }

  // ─── Acting ───────────────────────────────────────────────────────────────

  /**
   * Sends the user's message and runs the turn to its end, once the turn before it has ended. A
   * backend's question still open is abandoned: the backend is told, and the new message follows.
   * `context` goes with this turn's runs only, unseen in the transcript.
   */
  readonly sendMessage = (content: string, options: SendMessageOptions = {}): Promise<void> => {
    if (content.trim() === '') return Promise.resolve()
    this.#cancelBackendInterrupts()
    return this.#enqueue(
      () => {
        this.#agent.addMessage({ id: crypto.randomUUID(), role: 'user', content })
        return true
      },
      { context: options.context ?? [], forwardedProps: options.forwardedProps },
    )
  }

  /** Runs the last user message again, dropping whatever answered it. */
  readonly reload = (): Promise<void> => {
    this.stop()
    return this.#enqueue(
      () => {
        const history = this.#agent.messages
        const lastUser = history.findLastIndex(message => message.role === 'user')
        if (lastUser === -1) return false
        this.#agent.setMessages(history.slice(0, lastUser + 1))
        this.#pruneProgress()
        return true
      },
      { context: [], forwardedProps: undefined },
    )
  }

  /**
   * Stops the turn: the run in flight is aborted, every open question is answered as declined,
   * and a call left unanswered is answered as stopped, so the history stays one the backend reads.
   * A backend's open question is resumed as cancelled by the next run, as the spec wants.
   */
  readonly stop = (): void => {
    this.#generation += 1
    this.#turnAbort.abort()
    this.#agent.abortRun()
    // The call a backend's question is about stays the backend's to answer.
    const owedByBackend = new Set<string>()
    for (const interrupt of this.#interrupts) {
      const backend = interrupt.kind === 'generic' || interrupt.source === 'backend'
      if (backend && interrupt.toolCallId !== undefined) owedByBackend.add(interrupt.toolCallId)
      interrupt.cancel()
    }
    this.#answerUnansweredCalls(owedByBackend)
    if (this.#status !== 'error') this.#status = 'ready'
    this.#publish()
  }

  /** Stops the turn and starts a new conversation, on a new thread. */
  readonly clear = (): void => {
    this.stop()
    this.#agent.setMessages([])
    this.#agent.threadId = crypto.randomUUID()
    // The old thread's interrupts are not the new one's to resume.
    this.#agent.pendingInterrupts = []
    this.#progress.clear()
    this.#owed = []
    this.#lastRunId = undefined
    this.#runId = null
    this.#error = undefined
    this.#status = 'ready'
    this.#publish()
  }

  /** Replaces the history, for a conversation restored from where it was stored. */
  readonly setMessages = (messages: readonly Message[]): void => {
    this.#agent.setMessages([...messages])
    this.#pruneProgress()
    this.#publish()
  }

  /**
   * Shows the user a card for a page action and resolves whether they approved. The action
   * pipeline's approver calls it; a call the agent made is matched to its tool call by name.
   */
  readonly requestApproval = (question: ApprovalQuestion): Promise<boolean> =>
    new Promise(resolve => {
      const executing = this.#executing
      const toolCallId = executing?.name === question.toolName ? executing.callId : undefined
      this.#approvals += 1
      const id = `approval_${toolCallId ?? String(this.#approvals)}`
      if (toolCallId !== undefined)
        this.#progress.set(toolCallId, { ended: true, approval: { id } })

      let open = true
      const settle = (approved: boolean): void => {
        if (!open) return
        open = false
        this.#removeInterrupt(id)
        if (toolCallId !== undefined) {
          this.#progress.set(toolCallId, { ended: true, approval: { id, approved } })
        }
        this.#publish()
        resolve(approved)
      }

      this.#addInterrupt({
        kind: 'tool-approval',
        id,
        source: 'page',
        toolName: question.toolName,
        ...(toolCallId === undefined ? {} : { toolCallId }),
        originalArgs: question.input,
        ...(question.label === undefined ? {} : { label: question.label }),
        ...(question.description === undefined ? {} : { description: question.description }),
        resolveInterrupt: settle,
        cancel: () => {
          settle(false)
        },
      })
    })

  /** Takes new options; the connection, thread and initial messages are fixed at construction. */
  updateOptions(
    options: Partial<Omit<ChatClientOptions, 'connection' | 'threadId' | 'initialMessages'>>,
  ): void {
    this.#options = { ...this.#options, ...options }
  }

  dispose(): void {
    this.stop()
    this.#unsubscribeAgent()
    this.#listeners.clear()
  }

  // ─── The turn ─────────────────────────────────────────────────────────────

  /**
   * Runs a turn once every turn before it has ended; `prepare` readies the history for it, or says
   * there is nothing to run. Whatever the turn throws fails it, as a failed run does.
   */
  #enqueue(prepare: () => boolean, input: TurnInput): Promise<void> {
    const turn = this.#turn.then(async () => {
      if (!prepare()) return
      const generation = this.#generation
      this.#turnAbort = new AbortController()
      try {
        await this.#turnLoop(generation, this.#turnAbort.signal, input)
      } catch (error) {
        if (generation === this.#generation) this.#fail(toError(error))
      }
    })
    // Only `onError` throwing rejects it, which must not keep the next turn from running.
    this.#turn = turn.catch(() => undefined)
    return turn
  }

  async #turnLoop(generation: number, signal: AbortSignal, turnInput: TurnInput): Promise<void> {
    const maxRuns = this.#options.maxRunsPerTurn ?? DEFAULT_MAX_RUNS_PER_TURN
    let answers = this.#owed
    this.#owed = []
    // The tools a run answering calls still declares, though their mount may have gone: both
    // TanStack AI and Agent Framework recognise a page tool's answer by the tools the run declares.
    let answering: readonly Tool[] = []
    this.#error = undefined

    for (let run = 1; ; run += 1) {
      const tools = this.#tools()
      const byName = new Map(tools.map(tool => [tool.name, tool]))
      const declared = [...tools.map(toWire), ...answering.filter(tool => !byName.has(tool.name))]

      const finished = await this.#run(declared, answers, turnInput)
      if (generation !== this.#generation) return
      if (finished instanceof Error) {
        this.#fail(finished)
        return
      }
      if (finished.outcome === 'cancelled') break

      const calls = this.#callsById()
      const pageCall = (id: string | undefined) => {
        const call = id === undefined ? undefined : calls.get(id)
        const tool = call === undefined ? undefined : byName.get(call.function.name)
        return call === undefined || tool === undefined ? undefined : { call, tool }
      }
      // The page's calls to run, with the interrupt each answers, and the questions for the user.
      const toRun: { call: ToolCall; tool: ChatTool; interruptId?: string }[] = []
      const asked: Promise<ResumeEntry>[] = []
      // Whether every call this run made is answered by a tool whose result is for the user.
      let quiet: boolean

      if (finished.outcome === 'success') {
        // A pending call the page does not own is the backend's to answer; nothing runs it here.
        for (const id of finished.pending) {
          const found = pageCall(id)
          if (found !== undefined) toRun.push(found)
        }
        if (toRun.length === 0) break
        quiet = toRun.length === finished.pending.length
      } else {
        for (const interrupt of finished.interrupts) {
          // An interrupt on a call to one of the page's tools means "run it": the backend never
          // asks for a page tool's approval, as the action pipeline asks the user itself when the
          // action needs it. TanStack AI's backend ends a run this way where the spec leaves the
          // call pending. Answered both ways, as TanStack AI's own client does: the tool message,
          // and the payload.
          const found = pageCall(interrupt.toolCallId)
          if (found === undefined) asked.push(this.#ask(interrupt, calls))
          else toRun.push({ ...found, interruptId: interrupt.id })
        }
        quiet = asked.length === 0
      }

      const info = { threadId: this.#agent.threadId, runId: finished.runId, signal }
      const answered = new Set<string>()
      const ran: ResumeEntry[] = []
      if (toRun.length > 0) this.#setStatus('streaming')
      // One at a time: a pipeline approval then belongs to the one call running, and a stop runs
      // no more of them.
      for (const { call, tool, interruptId } of toRun) {
        if (generation !== this.#generation) return
        const result = await this.#execute(tool, call, info)
        answered.add(tool.name)
        if (followsUp(tool, result)) quiet = false
        if (interruptId !== undefined) {
          ran.push({ interruptId, status: 'resolved', payload: result })
        }
      }
      if (asked.length > 0) this.#setStatus('ready')
      answers = [...ran, ...(await Promise.all(asked))]

      if (generation !== this.#generation) return
      if (quiet) {
        // The result was for the user: the turn ends, and the backend reads the answers with the
        // next run, as it reads the tool messages already in the history.
        this.#owed = answers
        break
      }
      answering = declared.filter(tool => answered.has(tool.name))
      if (run === maxRuns) {
        this.#fail(new Error(`The turn took more than ${String(maxRuns)} runs, so it was stopped.`))
        return
      }
    }

    this.#setStatus('ready')
    this.#options.onFinish?.(
      this.#snapshot.messages.findLast(message => message.role === 'assistant'),
    )
  }

  /** One run: the finish it ended with, or why it failed. */
  async #run(
    tools: readonly Tool[],
    answers: readonly ResumeEntry[],
    turn: TurnInput,
  ): Promise<Finished | Error> {
    let finished: Finished | undefined
    let runError: Error | undefined
    this.#setStatus('submitted')

    try {
      this.#agent.headers = { ...this.#headers?.() }
      const resume = this.#resume(answers)
      await this.#agent.runAgent(
        {
          tools: [...tools],
          context: [...(this.#options.agentContext?.() ?? []), ...turn.context],
          ...(this.#options.forwardedProps === undefined && turn.forwardedProps === undefined
            ? {}
            : { forwardedProps: { ...this.#options.forwardedProps, ...turn.forwardedProps } }),
          ...(resume.length === 0 ? {} : { resume }),
        },
        {
          onRunFinishedEvent: params => {
            const runId = params.event.runId
            finished =
              params.outcome === 'success'
                ? { outcome: 'success', runId, pending: params.pendingToolCallIds }
                : params.outcome === 'interrupt'
                  ? { outcome: 'interrupt', runId, interrupts: params.interrupts }
                  : { outcome: 'cancelled', runId }
          },
          onRunErrorEvent: ({ event }) => {
            runError = new Error(event.message)
          },
        },
      )
    } catch (error) {
      runError ??= toError(error)
    }

    return runError ?? finished ?? new Error('The run ended without finishing.')
  }

  /**
   * What a run resumes: an entry for every interrupt the last run ended on, since the AG-UI client
   * refuses a run that leaves one open. One with no answer (the user stopped or cleared, or the run
   * that carried the answer failed) is resumed as cancelled, which the spec allows for any.
   */
  #resume(answers: readonly ResumeEntry[]): ResumeEntry[] {
    return this.#agent.pendingInterrupts.map(
      ({ id }) =>
        answers.find(answer => answer.interruptId === id) ?? {
          interruptId: id,
          status: 'cancelled',
        },
    )
  }

  /** Runs one of the page's tools and records its result as the call's answer. */
  async #execute(tool: ChatTool, call: ToolCall, info: RunInfo): Promise<unknown> {
    const parsed = parseArguments(call)
    let output: unknown
    let error: string | undefined = 'error' in parsed ? parsed.error : undefined

    if ('input' in parsed) {
      const executing = { name: tool.name, callId: call.id }
      this.#executing = executing
      try {
        output = await tool.execute(parsed.input, { toolCallId: call.id, ...info })
      } catch (thrown) {
        error = toError(thrown).message
      } finally {
        if (this.#executing === executing) this.#executing = undefined
      }
    }

    this.#addResult(
      call.id,
      error === undefined ? JSON.stringify(output ?? null) : JSON.stringify({ error }),
      error,
    )
    return error === undefined ? output : { error }
  }

  /** Shows the user a backend's interrupt and resolves with their answer. */
  #ask(interrupt: Interrupt, calls: ReadonlyMap<string, ToolCall>): Promise<ResumeEntry> {
    const call = interrupt.toolCallId === undefined ? undefined : calls.get(interrupt.toolCallId)
    return new Promise<ResumeEntry>(resolve => {
      let open = true
      const settle = (entry: ResumeEntry): void => {
        if (!open) return
        open = false
        this.#removeInterrupt(interrupt.id)
        this.#publish()
        resolve(entry)
      }
      const cancel = (): void => {
        settle({ interruptId: interrupt.id, status: 'cancelled' })
      }

      if (call !== undefined) {
        const input = parseArguments(call)
        const originalArgs = 'input' in input ? input.input : {}
        this.#progress.set(call.id, { ended: true, approval: { id: interrupt.id } })
        this.#addInterrupt({
          kind: 'tool-approval',
          id: interrupt.id,
          source: 'backend',
          toolName: call.function.name,
          toolCallId: call.id,
          originalArgs,
          ...(interrupt.message === undefined ? {} : { message: interrupt.message }),
          resolveInterrupt: approved => {
            this.#progress.set(call.id, { ended: true, approval: { id: interrupt.id, approved } })
            // Both backends read this payload: TanStack AI reads `approved`; Agent Framework
            // checks `toolCall` against the call it recorded when it asked.
            settle({
              interruptId: interrupt.id,
              status: 'resolved',
              payload: {
                approved,
                toolCall: { callId: call.id, name: call.function.name, arguments: originalArgs },
              },
            })
          },
          cancel,
        })
        return
      }

      this.#addInterrupt({
        kind: 'generic',
        id: interrupt.id,
        reason: interrupt.reason,
        ...(interrupt.message === undefined ? {} : { message: interrupt.message }),
        ...(interrupt.toolCallId === undefined ? {} : { toolCallId: interrupt.toolCallId }),
        ...(interrupt.responseSchema === undefined
          ? {}
          : { responseSchema: interrupt.responseSchema }),
        resolveInterrupt: payload => {
          settle({ interruptId: interrupt.id, status: 'resolved', payload })
        },
        cancel,
      })
    })
  }

  // ─── State ────────────────────────────────────────────────────────────────

  #tools(): readonly ChatTool[] {
    const { tools } = this.#options
    return typeof tools === 'function' ? tools({ threadId: this.#agent.threadId }) : (tools ?? [])
  }

  #callsById(): Map<string, ToolCall> {
    const calls = new Map<string, ToolCall>()
    for (const message of this.#agent.messages) {
      if (message.role !== 'assistant') continue
      for (const call of message.toolCalls ?? []) calls.set(call.id, call)
    }
    return calls
  }

  /**
   * Answers a call with a tool message, unless it is answered already or the history no longer
   * holds it: a tool still running when the chat was cleared or reloaded answers nothing.
   */
  #addResult(toolCallId: string, content: string, error: string | undefined): void {
    const exists = this.#agent.messages.some(
      message => message.role === 'tool' && message.toolCallId === toolCallId,
    )
    if (exists || !this.#callsById().has(toolCallId)) return
    this.#agent.addMessage({
      id: crypto.randomUUID(),
      role: 'tool',
      toolCallId,
      content,
      ...(error === undefined ? {} : { error }),
    })
  }

  /** Every call with no result and nothing running it: answered as stopped. */
  #answerUnansweredCalls(owedByBackend: ReadonlySet<string>): void {
    const answered = new Set(
      this.#agent.messages.flatMap(message =>
        message.role === 'tool' ? [message.toolCallId] : [],
      ),
    )
    for (const id of this.#callsById().keys()) {
      if (answered.has(id) || id === this.#executing?.callId || owedByBackend.has(id)) continue
      this.#addResult(id, JSON.stringify({ error: STOPPED }), STOPPED)
    }
  }

  #cancelBackendInterrupts(): void {
    for (const interrupt of this.#interrupts) {
      if (interrupt.kind === 'generic' || interrupt.source === 'backend') interrupt.cancel()
    }
  }

  /** Drops what the client knows of calls the history no longer holds. */
  #pruneProgress(): void {
    const calls = this.#callsById()
    for (const id of this.#progress.keys()) if (!calls.has(id)) this.#progress.delete(id)
  }

  #addInterrupt(interrupt: ChatInterrupt): void {
    this.#interrupts = [...this.#interrupts, interrupt]
    this.#publish()
  }

  #removeInterrupt(id: string): void {
    this.#interrupts = this.#interrupts.filter(interrupt => interrupt.id !== id)
  }

  #markEnded(toolCallId: string): void {
    const progress = this.#progress.get(toolCallId)
    if (progress !== undefined && !progress.ended) {
      this.#progress.set(toolCallId, { ...progress, ended: true })
    }
  }

  #setStatus(status: ChatClientState): void {
    if (this.#status === status) return
    this.#status = status
    this.#publish()
  }

  #fail(error: Error): void {
    this.#error = error
    this.#status = 'error'
    this.#publish()
    this.#options.onError?.(error)
  }

  #computeSnapshot(): ChatSnapshot {
    return {
      messages: toUIMessages(this.#agent.messages, this.#progress),
      status: this.#status,
      isLoading: this.#status === 'submitted' || this.#status === 'streaming',
      error: this.#error,
      interrupts: this.#interrupts,
      threadId: this.#agent.threadId,
      runId: this.#runId,
    }
  }

  #publish(): void {
    this.#snapshot = this.#computeSnapshot()
    for (const listener of this.#listeners) listener()
  }
}
