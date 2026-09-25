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

import { HttpAgent, type HttpAgentConfig, type RunAgentParameters } from '@ag-ui/client'
import type {
  Context,
  Interrupt,
  Message,
  ResumeEntry,
  RunAgentInput,
  Tool,
  ToolCall,
} from '@ag-ui/core'

import type { ChatConnection } from './connection.ts'
import { limitHistory } from './history.ts'
import { createMessageView, type ToolCallProgress } from './message-view.ts'
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

/** What the agent is told of a call the turn failed before it ran. */
const FAILED = 'The turn failed before this tool ran.'

/** What the agent is told of a call to a tool the page does not have. */
function noSuchTool(name: string): string {
  return `No tool named "${name}" is available on this page.`
}

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

/** The input of a turn nobody gave options for, such as one restored from a stored history. */
const NO_TURN_INPUT: TurnInput = { context: [], forwardedProps: undefined }

function turnInputOf(options: SendMessageOptions): TurnInput {
  return { context: options.context ?? [], forwardedProps: options.forwardedProps }
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

/**
 * The AG-UI client, sending the messages the chat chooses. `prepareRunAgentInput` is where it
 * copies its history into a run's input, so what is left out there is left out of the request
 * only: the run's events are applied to `messages`, which stays whole, and a throw there fails the
 * run before anything is sent.
 */
class ChatAgent extends HttpAgent {
  readonly #outgoing: (messages: Message[]) => Message[]

  constructor(config: HttpAgentConfig, outgoing: (messages: Message[]) => Message[]) {
    super(config)
    this.#outgoing = outgoing
  }

  protected override prepareRunAgentInput(parameters?: RunAgentParameters): RunAgentInput {
    const input = super.prepareRunAgentInput(parameters)
    return { ...input, messages: this.#outgoing(input.messages) }
  }
}

/** TanStack AI's `ChatClient`, on the plain AG-UI client; see the module comment. */
export class ChatClient {
  #options: ChatClientOptions
  readonly #agent: ChatAgent
  readonly #headers: ChatConnection['headers']
  readonly #unsubscribeAgent: () => void
  /** What the client has seen of each call in the history; pruned when the history is replaced. */
  readonly #progress = new Map<string, ToolCallProgress>()
  readonly #view = createMessageView()
  /**
   * What each user message in the history was sent with, by its id, so `reload` sends it again;
   * pruned with `#progress`.
   */
  readonly #turnInputs = new Map<string, TurnInput>()
  /**
   * The page tool running now, where a pipeline approval belongs. A turn runs its tools one at a
   * time and turns never overlap, so there is at most one.
   */
  #executing: { readonly name: string; readonly callId: string } | undefined
  readonly #listeners = new Set<() => void>()
  #interrupts: readonly ChatInterrupt[] = []
  /**
   * The backend's interrupts the user was asked about since the last run finished: a call one of
   * them names is the backend's to answer once it is resumed, even after its card has closed.
   */
  readonly #asked = new Set<string>()
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
    this.#agent = new ChatAgent(
      {
        url: connection.url,
        ...(connection.fetch === undefined ? {} : { fetch: connection.fetch }),
        ...(options.threadId === undefined ? {} : { threadId: options.threadId }),
        ...(options.initialMessages === undefined
          ? {}
          : { initialMessages: [...options.initialMessages] }),
      },
      messages => this.#outgoing(messages),
    )

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
        // Whatever the finished run resumed is settled; what it ended on is asked afresh.
        this.#asked.clear()
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
   * `options` go with this turn's runs only, unseen in the transcript, and again with a `reload`
   * of it.
   */
  readonly sendMessage = (content: string, options: SendMessageOptions = {}): Promise<void> => {
    if (content.trim() === '') return Promise.resolve()
    this.#cancelBackendInterrupts()
    return this.#enqueue(() => this.#addUserMessage(content, turnInputOf(options)))
  }

  /**
   * Runs the last user message again, dropping whatever answered it, with the options it was sent
   * with: the context and forwarded props of a prompt, or of a press in UI the chat showed, are
   * part of the question. A message restored from a stored history has none.
   */
  readonly reload = (): Promise<void> => {
    this.stop()
    return this.#enqueue(() => {
      const lastUser = this.#agent.messages.findLastIndex(message => message.role === 'user')
      const message = this.#agent.messages[lastUser]
      if (message === undefined) return undefined
      this.#truncate(lastUser + 1)
      return this.#turnInputs.get(message.id) ?? NO_TURN_INPUT
    })
  }

  /**
   * Replaces the user message `messageId` with `text` and runs the conversation again from there:
   * every message after it, the agent's included, is dropped, and `text` is sent as a new turn,
   * with `options`, as `sendMessage` sends it. The edited message's own options are not carried
   * over: the edit is a new question, and the caller says what goes with it. A turn in flight is
   * stopped first, as `reload` stops it. An id that is not a user message in the history, or an
   * empty text, changes nothing: an edit can race a `clear` or `setMessages`, and there is nothing
   * left to edit then.
   */
  readonly editMessage = (
    messageId: string,
    text: string,
    options: SendMessageOptions = {},
  ): Promise<void> => {
    if (text.trim() === '' || this.#indexOfUserMessage(messageId) === -1) return Promise.resolve()
    this.stop()
    return this.#enqueue(() => {
      // Found again: the history may have been cleared or replaced while the turn before ran.
      const index = this.#indexOfUserMessage(messageId)
      if (index === -1) return undefined
      this.#truncate(index)
      // A new id: to a backend that keeps what it was sent, this is a message it has not seen.
      return this.#addUserMessage(text, turnInputOf(options))
    })
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
    const heldByBackend = this.#callsHeldByBackend()
    for (const interrupt of this.#interrupts) interrupt.cancel()
    this.#answerUnansweredCalls(heldByBackend, STOPPED)
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
    this.#asked.clear()
    this.#progress.clear()
    this.#turnInputs.clear()
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
    this.#pruneToHistory()
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
   * Runs a turn once every turn before it has ended; `prepare` readies the history for it and
   * gives what its runs send besides, or says there is nothing to run. Whatever the turn throws
   * fails it, as a failed run does.
   */
  #enqueue(prepare: () => TurnInput | undefined): Promise<void> {
    const turn = this.#turn.then(async () => {
      const input = prepare()
      if (input === undefined) return
      const generation = this.#generation
      this.#turnAbort = new AbortController()
      let failure: Error | undefined
      try {
        failure = await this.#turnLoop(generation, this.#turnAbort.signal, input)
      } catch (error) {
        if (generation === this.#generation) failure = this.#fail(toError(error))
      }
      // Reported outside the turn, so a handler that throws rejects this call and changes nothing
      // else: the turn's error stays the one it failed with, and the handler is called once.
      if (failure !== undefined) this.#options.onError?.(failure)
    })
    // Only `onError` throwing rejects it, which must not keep the next turn from running.
    this.#turn = turn.catch(() => undefined)
    return turn
  }

  /** Runs the turn to its end; the error it failed with, if it failed. */
  async #turnLoop(
    generation: number,
    signal: AbortSignal,
    turnInput: TurnInput,
  ): Promise<Error | undefined> {
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
      if (finished instanceof Error) return this.#fail(finished)
      if (finished.outcome === 'cancelled') break

      const calls = this.#callsById()
      const pageCall = (id: string | undefined) => {
        const call = id === undefined ? undefined : calls.get(id)
        const tool = call === undefined ? undefined : byName.get(call.function.name)
        return call === undefined || tool === undefined ? undefined : { call, tool }
      }
      // The calls to answer, with the page's tool that runs each (none for a call to a tool the
      // page does not have) and the interrupt each answers, and the questions for the user.
      const toRun: { call: ToolCall; tool: ChatTool | undefined; interruptId?: string }[] = []
      const asked: Promise<ResumeEntry>[] = []
      // Whether every call this run made is answered by a tool whose result is for the user.
      let quiet = true

      if (finished.outcome === 'success') {
        // A pending call waits on the client, so every one is answered here: a call to a tool the
        // page does not have (a name the model made up, or a tool discovery has not declared yet)
        // is answered with an error the model can recover from. Left unanswered, it would sit in
        // the history without a result, and a model API rejects every later request for it.
        const withResult = this.#answeredCallIds()
        for (const id of finished.pending) {
          const call = calls.get(id)
          if (call === undefined || withResult.has(id)) continue
          toRun.push(pageCall(id) ?? { call, tool: undefined })
        }
        if (toRun.length === 0) break
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
        // Still declared by the answering run if this one declared it, as a page tool's answer is.
        answered.add(call.function.name)
        if (tool === undefined) {
          const error = noSuchTool(call.function.name)
          this.#addResult(call.id, JSON.stringify({ error }), error)
          quiet = false
          continue
        }
        const result = await this.#execute(tool, call, info)
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
        return this.#fail(
          new Error(`The turn took more than ${String(maxRuns)} runs, so it was stopped.`),
        )
      }
    }

    this.#setStatus('ready')
    this.#options.onFinish?.(
      this.#snapshot.messages.findLast(message => message.role === 'assistant'),
    )
    return undefined
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
    this.#asked.add(interrupt.id)
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

  /** The messages a run sends: those the AG-UI client would send, through `history`. */
  #outgoing(messages: Message[]): Message[] {
    const { history } = this.#options
    if (history === false) return messages
    if (typeof history === 'function') return [...history(messages)]
    return limitHistory(messages, history)
  }

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

  #answeredCallIds(): Set<string> {
    return new Set(
      this.#agent.messages.flatMap(message =>
        message.role === 'tool' ? [message.toolCallId] : [],
      ),
    )
  }

  /**
   * Every call with no result, nothing running it and no backend's interrupt holding it, answered
   * with `reason`, so the history stays one the backend reads; and no call is left streaming.
   */
  #answerUnansweredCalls(heldByBackend: ReadonlySet<string>, reason: string): void {
    const answered = this.#answeredCallIds()
    for (const id of this.#callsById().keys()) {
      if (answered.has(id) || id === this.#executing?.callId || heldByBackend.has(id)) continue
      this.#addResult(id, JSON.stringify({ error: reason }), reason)
    }
    for (const id of this.#progress.keys()) this.#markEnded(id)
  }

  /**
   * The calls a backend's interrupt is about, whether its card is still open or the answer is
   * waiting on a run: the backend answers them itself once the interrupt is resumed, as cancelled
   * if nothing else. A page tool's interrupt is not among them: the page answers that call.
   */
  #callsHeldByBackend(): Set<string> {
    const held = new Set<string>()
    for (const interrupt of this.#interrupts) {
      const backend = interrupt.kind === 'generic' || interrupt.source === 'backend'
      if (backend && interrupt.toolCallId !== undefined) held.add(interrupt.toolCallId)
    }
    for (const { id, toolCallId } of this.#agent.pendingInterrupts) {
      if (this.#asked.has(id) && toolCallId !== undefined) held.add(toolCallId)
    }
    return held
  }

  #cancelBackendInterrupts(): void {
    for (const interrupt of this.#interrupts) {
      if (interrupt.kind === 'generic' || interrupt.source === 'backend') interrupt.cancel()
    }
  }

  /** Adds a user message and remembers what its turn sends, for a `reload` of it. */
  #addUserMessage(content: string, input: TurnInput): TurnInput {
    const id = crypto.randomUUID()
    this.#agent.addMessage({ id, role: 'user', content })
    this.#turnInputs.set(id, input)
    return input
  }

  #indexOfUserMessage(id: string): number {
    return this.#agent.messages.findIndex(message => message.id === id && message.role === 'user')
  }

  /**
   * Cuts the history back to its first `length` messages, for a turn run again from there. The
   * runs after the cut go with it, and so does any answer owed to their interrupts: the call it
   * answered is gone. The interrupts stay pending, and the next run resumes them as cancelled,
   * since the backend may still hold them open on this thread. It runs in the turn queue, after
   * the turn before has ended, so a result a stopped tool gave late is cut with its call.
   */
  #truncate(length: number): void {
    this.#agent.setMessages(this.#agent.messages.slice(0, length))
    this.#owed = []
    this.#pruneToHistory()
  }

  /** Drops what the client knows of calls and user messages the history no longer holds. */
  #pruneToHistory(): void {
    const calls = this.#callsById()
    for (const id of this.#progress.keys()) if (!calls.has(id)) this.#progress.delete(id)
    const ids = new Set(this.#agent.messages.map(message => message.id))
    for (const id of this.#turnInputs.keys()) if (!ids.has(id)) this.#turnInputs.delete(id)
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

  /**
   * Fails the turn. A call the failed run made, or one the turn had yet to run, is answered as
   * failed, so the next turn's request pairs every call with a result, as model APIs require.
   * Returns the error for the turn to report; `onError` is not called here.
   */
  #fail(error: Error): Error {
    this.#answerUnansweredCalls(this.#callsHeldByBackend(), FAILED)
    this.#error = error
    this.#status = 'error'
    this.#publish()
    return error
  }

  #computeSnapshot(): ChatSnapshot {
    return {
      messages: this.#view(this.#agent.messages, this.#progress),
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
