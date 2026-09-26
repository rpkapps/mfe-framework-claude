/**
 * What the two real models share: the request, the stream it answers with, and the AG-UI events
 * of the reply. Each adapter only reads its own API's payloads into the calls of a `Reply`.
 */

import { EventType, type AGUIEvent, type RunAgentInput } from '@ag-ui/core'

import { runError, runFinished, runStarted } from './events.ts'
import { serverSentEvents } from './sse.ts'

/**
 * The AG-UI events of one streamed reply. One thing is open at a time: the reasoning, a text
 * message or a tool call is closed before the next begins, so the chat shows them in the order the
 * model wrote them, and `end` closes the last, so `RUN_FINISHED` never leaves one open (AG-UI's
 * client refuses a run that does).
 */
export class Reply {
  readonly #runId: string
  #messages = 0
  #textSeen = false
  #open: { readonly kind: 'reasoning' | 'text' | 'tool'; readonly id: string } | undefined
  /** The calls the page is left to answer, in the order they started. */
  readonly pending: string[] = []

  constructor(runId: string) {
    this.#runId = runId
  }

  /** The assistant message tool calls attach to. */
  get #parentId(): string {
    return `msg_${this.#runId}`
  }

  /** Ends whatever is open. */
  close(): AGUIEvent[] {
    const open = this.#open
    this.#open = undefined
    if (open === undefined) return []
    if (open.kind === 'text') return [{ type: EventType.TEXT_MESSAGE_END, messageId: open.id }]
    if (open.kind === 'tool') return [{ type: EventType.TOOL_CALL_END, toolCallId: open.id }]
    return [
      { type: EventType.REASONING_MESSAGE_END, messageId: open.id },
      { type: EventType.REASONING_END, messageId: open.id },
    ]
  }

  reasoning(delta: string): AGUIEvent[] {
    if (delta === '') return []
    const events: AGUIEvent[] = []
    if (this.#open?.kind !== 'reasoning') {
      events.push(...this.close())
      this.#messages += 1
      const id = `reasoning_${this.#runId}_${String(this.#messages)}`
      this.#open = { kind: 'reasoning', id }
      events.push(
        { type: EventType.REASONING_START, messageId: id },
        { type: EventType.REASONING_MESSAGE_START, messageId: id, role: 'reasoning' },
      )
    }
    events.push({ type: EventType.REASONING_MESSAGE_CONTENT, messageId: this.#open.id, delta })
    return events
  }

  text(delta: string): AGUIEvent[] {
    if (delta === '') return []
    const events: AGUIEvent[] = []
    if (this.#open?.kind !== 'text') {
      events.push(...this.close())
      this.#messages += 1
      // The first text is the message tool calls attach to; later ones are messages of their own.
      const id = this.#textSeen ? `msg_${this.#runId}_${String(this.#messages)}` : this.#parentId
      this.#textSeen = true
      this.#open = { kind: 'text', id }
      events.push({ type: EventType.TEXT_MESSAGE_START, messageId: id, role: 'assistant' })
    }
    events.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: this.#open.id, delta })
    return events
  }

  /** A new call; without an id from the model, it gets one of its own. */
  toolCall(id: string | undefined, name: string | undefined): { id: string; events: AGUIEvent[] } {
    const callId =
      id === undefined || id === '' ? `call_${this.#runId}_${String(this.pending.length)}` : id
    const events = this.close()
    this.pending.push(callId)
    this.#open = { kind: 'tool', id: callId }
    events.push({
      type: EventType.TOOL_CALL_START,
      toolCallId: callId,
      toolCallName: name === undefined || name === '' ? 'unknown_tool' : name,
      parentMessageId: this.#parentId,
    })
    return { id: callId, events }
  }

  /** A piece of a call's arguments. A late piece of a call already closed cannot be sent. */
  toolArgs(id: string, delta: string): AGUIEvent[] {
    if (delta === '' || this.#open?.kind !== 'tool' || this.#open.id !== id) return []
    return [{ type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta }]
  }
}

/** What one payload of a model's stream says: events to send, or the error that ends the run. */
export type Read = readonly AGUIEvent[] | { readonly error: string }

export interface StreamedRequest {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
  readonly fetch: typeof globalThis.fetch
}

export interface StreamReader {
  /** One payload of the stream, parsed. */
  read(payload: unknown): Read
  /** What is left once the stream has ended, open things closed. */
  end(): readonly AGUIEvent[]
  /** The calls the run leaves for the page. */
  readonly pending: readonly string[]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A run against a streaming model API: `RUN_STARTED`, the request, each payload through the
 * reader, then `RUN_FINISHED` with the calls pending, or `RUN_ERROR` when the model cannot be
 * reached, refuses, or reports an error in the stream. Nothing follows once the client has gone.
 */
export async function* streamedRun(
  input: RunAgentInput,
  signal: AbortSignal,
  request: StreamedRequest,
  reader: StreamReader,
): AsyncGenerator<AGUIEvent> {
  yield runStarted(input)

  let response: Response
  try {
    response = await request.fetch(request.url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
    })
  } catch (error) {
    if (!signal.aborted) {
      yield runError(`The model at ${request.url} could not be reached: ${messageOf(error)}`)
    }
    return
  }
  if (!response.ok || response.body === null) {
    const detail = await response.text().catch(() => '')
    yield runError(`The model answered ${String(response.status)}: ${detail}`)
    return
  }

  try {
    for await (const data of serverSentEvents(response.body)) {
      // The OpenAI API's end of stream; Anthropic's ends with `message_stop`.
      if (data === '[DONE]') break
      let payload: unknown
      try {
        payload = JSON.parse(data)
      } catch {
        continue
      }
      const read = reader.read(payload)
      if ('error' in read) {
        yield runError(read.error)
        return
      }
      yield* read
    }
  } catch (error) {
    if (!signal.aborted) yield runError(`The model's stream broke off: ${messageOf(error)}`)
    return
  }

  if (signal.aborted) return
  yield* reader.end()
  yield runFinished(input, reader.pending)
}
