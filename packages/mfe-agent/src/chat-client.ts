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

import { toUIMessages, type ToolCallProgress } from './message-view.ts'
import type {
  ApprovalQuestion,
  ChatClientOptions,
  ChatClientState,
  ChatInterrupt,
  ChatSnapshot,
  ChatTool,
  SendMessageOptions,
  UIMessage,
} from './types.ts'

const DEFAULT_MAX_RUNS_PER_TURN = 12

/** What the user is told a tool was answered when they stopped the turn before it ran. */
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

/** Whether the agent carries on after this result: the tool's `followUp`, `true` by default. */
function followsUp(tool: ChatTool, result: unknown): boolean {
  const { followUp } = tool
  return typeof followUp === 'function' ? followUp(result) : followUp !== false
}

interface RunInfo {
  readonly threadId: string
  readonly runId: string
  readonly signal: AbortSignal
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
  readonly #unsubscribeAgent: () => void
  readonly #progress = new Map<string, ToolCallProgress>()
  /** The page tools running now, by tool name: where a pipeline approval belongs. */
  readonly #executing = new Map<string, string>()
  readonly #listeners = new Set<() => void>()
  #interrupts: readonly ChatInterrupt[] = []
  /**
   * Answers owed to the backend's interrupts, sent with the next run: those the user walked away
   * from, as cancelled, and those a tool that does not follow up answered, as resolved.
   */
  #owed: ResumeEntry[] = []
  #status: ChatClientState = 'ready'
  #error: Error | undefined
  #runId: string | null = null
  #lastRunId: string | undefined
  /** Bumped by `stop` and `clear`, so a turn in flight stops at its next step. */
  #generation = 0
  /** Aborted by `stop`, for the tools of the turn in flight. */
  #turnAbort = new AbortController()
  #turn: Promise<void> | undefined
  #approvals = 0
  #snapshot: ChatSnapshot

  constructor(options: ChatClientOptions) {
    this.#options = options
    const { connection } = options
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
   * Sends the user's message and runs the turn to its end. A question still open from the last
   * turn is abandoned: the backend is told, and the new message follows. `context` goes with this
   * turn's runs only, unseen in the transcript.
   */
  readonly sendMessage = async (
    content: string,
    options: SendMessageOptions = {},
  ): Promise<void> => {
    if (content.trim() === '') return
    this.#cancelBackendInterrupts()
    await this.#turn
    this.#agent.addMessage({ id: crypto.randomUUID(), role: 'user', content })
    await this.#runTurn(options.context ?? [], options.forwardedProps)
  }

  /** Runs the last user message again, dropping whatever answered it. */
  readonly reload = async (): Promise<void> => {
    this.stop()
    await this.#turn
    const history = this.#agent.messages
    const lastUser = history.findLastIndex(message => message.role === 'user')
    if (lastUser === -1) return
    this.#agent.setMessages(history.slice(0, lastUser + 1))
    await this.#runTurn([])
  }

  /**
   * Stops the turn: the run in flight is aborted, every open question is answered as declined,
   * and a call left unanswered is answered as stopped, so the history stays one the backend reads.
   */
  readonly stop = (): void => {
    this.#generation += 1
    this.#turnAbort.abort()
    this.#agent.abortRun()
    // A backend's open question is still owed an answer, and the AG-UI spec wants the next run to
    // resume it: that run tells the backend it was dropped. Its call is the backend's to answer.
    const owedByBackend = new Set<string>()
    for (const interrupt of this.#interrupts) {
      if (interrupt.kind === 'generic' || interrupt.source === 'backend') {
        this.#owed.push({ interruptId: interrupt.id, status: 'cancelled' })
        if (interrupt.toolCallId !== undefined) owedByBackend.add(interrupt.toolCallId)
      }
      interrupt.cancel()
    }
    this.#answerUnansweredCalls(owedByBackend)
    if (this.#status !== 'error') this.#status = 'ready'
    this.#publish()
  }

  readonly clear = (): void => {
    this.stop()
    this.#agent.setMessages([])
    this.#agent.threadId = crypto.randomUUID()
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
    this.#publish()
  }

  /**
   * Shows the user a card for a page action and resolves whether they approved. The action
   * pipeline's approver calls it; a call the agent made is matched to its tool call by name.
   */
  readonly requestApproval = (question: ApprovalQuestion): Promise<boolean> =>
    new Promise(resolve => {
      const toolCallId = this.#executing.get(question.toolName)
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

  async #runTurn(
    context: readonly Context[],
    forwardedProps?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    this.#turnAbort = new AbortController()
    const turn = this.#turnLoop(this.#generation, { context, forwardedProps })
    this.#turn = turn
    try {
      await turn
    } finally {
      if (this.#turn === turn) this.#turn = undefined
    }
  }

  async #turnLoop(generation: number, turnInput: TurnInput): Promise<void> {
    const maxRuns = this.#options.maxRunsPerTurn ?? DEFAULT_MAX_RUNS_PER_TURN
    let resume: ResumeEntry[] | undefined = this.#takeOwed()
    // The tools a run answering calls still declares, though their mount may have gone: both
    // TanStack AI and Agent Framework recognise a page tool's answer by the tools the run declares.
    let answering: readonly Tool[] = []
    this.#error = undefined

    for (let run = 0; run < maxRuns; run += 1) {
      const tools = this.#tools()
      const byName = new Map(tools.map(tool => [tool.name, tool]))
      const declared = [...tools.map(toWire), ...answering.filter(tool => !byName.has(tool.name))]

      const finished = await this.#run(declared, resume, turnInput)
      if (generation !== this.#generation) return
      if (finished instanceof Error) {
        this.#fail(finished)
        return
      }

      const info = {
        threadId: this.#agent.threadId,
        runId: finished.runId,
        signal: this.#turnAbort.signal,
      }
      const calls = this.#callsById()
      const answered = new Set<string>()
      resume = undefined
      // Whether every call this run made was answered by a tool whose result is for the user.
      let quiet: boolean

      if (finished.outcome === 'success') {
        const ours = finished.pending
          .map(id => calls.get(id))
          .filter((call): call is ToolCall => call !== undefined && byName.has(call.function.name))
        // A pending call the page does not own is the backend's to answer; nothing runs it here.
        if (ours.length === 0) break
        this.#setStatus('streaming')
        let allQuiet = ours.length === finished.pending.length
        for (const call of ours) {
          const tool = byName.get(call.function.name)
          if (tool === undefined) continue
          const result = await this.#execute(tool, call, info)
          answered.add(tool.name)
          if (followsUp(tool, result)) allQuiet = false
        }
        quiet = allQuiet
      } else if (finished.outcome === 'interrupt') {
        const quietAnswers = new Set<string>()
        const answers = finished.interrupts.map(interrupt =>
          this.#answer(interrupt, calls, byName, info, answered, quietAnswers),
        )
        resume = await Promise.all(answers)
        quiet = finished.interrupts.every(interrupt => quietAnswers.has(interrupt.id))
      } else {
        break
      }

      if (generation !== this.#generation) return
      if (quiet) {
        // The result was for the user: the turn ends, and the backend reads the answers with the
        // next run, as it reads the tool messages already in the history.
        this.#owed.push(...(resume ?? []))
        break
      }
      answering = declared.filter(tool => answered.has(tool.name))
      if (run === maxRuns - 1) {
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
    resume: ResumeEntry[] | undefined,
    turn: TurnInput,
  ): Promise<Finished | Error> {
    let finished: Finished | undefined
    let runError: Error | undefined
    this.#agent.headers = { ...this.#options.connection.headers?.() }
    this.#setStatus('submitted')

    try {
      await this.#agent.runAgent(
        {
          tools: [...tools],
          context: [...(this.#options.agentContext?.() ?? []), ...turn.context],
          ...(this.#options.forwardedProps === undefined && turn.forwardedProps === undefined
            ? {}
            : { forwardedProps: { ...this.#options.forwardedProps, ...turn.forwardedProps } }),
          ...(resume === undefined || resume.length === 0 ? {} : { resume }),
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

  /** Runs one of the page's tools and records its result as the call's answer. */
  async #execute(tool: ChatTool, call: ToolCall, info: RunInfo): Promise<unknown> {
    const parsed = parseArguments(call)
    let output: unknown
    let error: string | undefined = 'error' in parsed ? parsed.error : undefined

    if ('input' in parsed) {
      this.#executing.set(tool.name, call.id)
      try {
        output = await tool.execute(parsed.input, { toolCallId: call.id, ...info })
      } catch (thrown) {
        error = toError(thrown).message
      } finally {
        if (this.#executing.get(tool.name) === call.id) this.#executing.delete(tool.name)
      }
    }

    this.#addResult(
      call.id,
      error === undefined ? JSON.stringify(output ?? null) : JSON.stringify({ error }),
      error,
    )
    return error === undefined ? output : { error }
  }

  /** The answer to one interrupt: run the page's tool, or ask the user and wait. */
  async #answer(
    interrupt: Interrupt,
    calls: ReadonlyMap<string, ToolCall>,
    tools: ReadonlyMap<string, ChatTool>,
    info: RunInfo,
    answered: Set<string>,
    quiet: Set<string>,
  ): Promise<ResumeEntry> {
    const call = interrupt.toolCallId === undefined ? undefined : calls.get(interrupt.toolCallId)
    const tool = call === undefined ? undefined : tools.get(call.function.name)

    // An interrupt on a call to one of the page's tools means "run it": the backend never asks for
    // a page tool's approval, as the action pipeline asks the user itself when the action needs it.
    // TanStack AI's backend ends a run this way where the spec leaves the call pending. Answered
    // both ways, as TanStack AI's own client does: the tool message, and the payload.
    if (call !== undefined && tool !== undefined) {
      this.#setStatus('streaming')
      const payload = await this.#execute(tool, call, info)
      answered.add(tool.name)
      if (!followsUp(tool, payload)) quiet.add(interrupt.id)
      return { interruptId: interrupt.id, status: 'resolved', payload }
    }

    this.#setStatus('ready')
    return await new Promise<ResumeEntry>(resolve => {
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

  #addResult(toolCallId: string, content: string, error: string | undefined): void {
    const exists = this.#agent.messages.some(
      message => message.role === 'tool' && message.toolCallId === toolCallId,
    )
    if (exists) return
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
    const running = new Set(this.#executing.values())
    const answered = new Set(
      this.#agent.messages.flatMap(message =>
        message.role === 'tool' ? [message.toolCallId] : [],
      ),
    )
    for (const id of this.#callsById().keys()) {
      if (answered.has(id) || running.has(id) || owedByBackend.has(id)) continue
      this.#addResult(id, JSON.stringify({ error: STOPPED }), STOPPED)
    }
  }

  #cancelBackendInterrupts(): void {
    for (const interrupt of this.#interrupts) {
      if (interrupt.kind === 'generic' || interrupt.source === 'backend') interrupt.cancel()
    }
  }

  #takeOwed(): ResumeEntry[] | undefined {
    if (this.#owed.length === 0) return undefined
    const owed = this.#owed
    this.#owed = []
    return owed
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
