/**
 * A real model for development through any OpenAI-compatible chat completions endpoint: a model on
 * your own machine or network behind vLLM, SGLang, llama.cpp's server, Ollama or LM Studio, or a
 * hosted one. Streamed, and translated to AG-UI as the Anthropic adapter is. Every tool is the
 * page's, so a run that calls tools ends with them pending for the page to answer.
 *
 * A reasoning model's thinking arrives as `reasoning_content` (DeepSeek's field, which vLLM and
 * SGLang also use), as `reasoning`, or inline between `<think>` tags when the server does not
 * split it out; all three become AG-UI reasoning, which the chat shows as "Thinking". It is never
 * sent back to the model.
 */

import { EventType, type AGUIEvent, type RunAgentInput } from '@ag-ui/core'

import { runError, runFinished, runStarted, type Model } from './events.ts'
import { systemPrompt, textOf } from './prompt.ts'
import { serverSentEvents } from './sse.ts'

export interface OpenAiModelOptions {
  /** The API's base URL, `/v1` included (`http://10.0.0.5:8000/v1`), or the full completions URL. */
  readonly baseUrl: string
  /** The model id the server serves, from `AGENT_DEV_MODEL`. */
  readonly model: string
  /** Sent as a bearer token when the server wants one. */
  readonly apiKey?: string
  readonly maxTokens?: number
  readonly fetch?: typeof globalThis.fetch
}

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

/** AG-UI history as chat completions messages; reasoning is the model's own and is left out. */
export function toChatMessages(input: RunAgentInput): ChatMessage[] {
  const system = [systemPrompt(input)]
  const messages: ChatMessage[] = []

  for (const message of input.messages) {
    switch (message.role) {
      case 'user':
        messages.push({ role: 'user', content: textOf(message) })
        break
      case 'assistant': {
        const text = textOf(message)
        const calls = message.toolCalls ?? []
        if (text === '' && calls.length === 0) break
        messages.push({
          role: 'assistant',
          content: text === '' ? null : text,
          ...(calls.length === 0
            ? {}
            : {
                tool_calls: calls.map(call => ({
                  id: call.id,
                  type: 'function' as const,
                  function: {
                    name: call.function.name,
                    arguments: call.function.arguments === '' ? '{}' : call.function.arguments,
                  },
                })),
              }),
        })
        break
      }
      case 'tool':
        messages.push({ role: 'tool', tool_call_id: message.toolCallId, content: textOf(message) })
        break
      case 'system':
      case 'developer':
        system.push(textOf(message))
        break
      default:
        break
    }
  }

  return [{ role: 'system', content: system.join('\n') }, ...messages]
}

/** Where the completions go: a base URL gets `/chat/completions`, a full one is kept. */
export function completionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
}

const OPEN = '<think>'
const CLOSE = '</think>'

/**
 * Splits streamed content into reasoning and text at `<think>` tags, which may be cut anywhere
 * between two chunks: the tail that could still become a tag is held back until it cannot.
 */
export class ThinkSplitter {
  #thinking = false
  #held = ''

  push(delta: string): { readonly kind: 'text' | 'reasoning'; readonly text: string }[] {
    let rest = this.#held + delta
    this.#held = ''
    const out: { kind: 'text' | 'reasoning'; text: string }[] = []
    const emit = (text: string): void => {
      if (text !== '') out.push({ kind: this.#thinking ? 'reasoning' : 'text', text })
    }

    for (;;) {
      const tag = this.#thinking ? CLOSE : OPEN
      const at = rest.indexOf(tag)
      if (at !== -1) {
        emit(rest.slice(0, at))
        this.#thinking = !this.#thinking
        rest = rest.slice(at + tag.length)
        continue
      }
      // Keep back the longest tail that is the start of the tag.
      let keep = 0
      for (let length = Math.min(tag.length - 1, rest.length); length > 0; length -= 1) {
        if (tag.startsWith(rest.slice(-length))) {
          keep = length
          break
        }
      }
      emit(rest.slice(0, rest.length - keep))
      this.#held = rest.slice(rest.length - keep)
      return out
    }
  }

  /** What is held back, once the stream has ended. */
  flush(): { readonly kind: 'text' | 'reasoning'; readonly text: string }[] {
    const held = this.#held
    this.#held = ''
    return held === '' ? [] : [{ kind: this.#thinking ? 'reasoning' : 'text', text: held }]
  }
}

interface ChunkToolCall {
  readonly index?: number
  readonly id?: string
  readonly function?: { readonly name?: string; readonly arguments?: string }
}

interface Chunk {
  readonly error?: { readonly message?: string } | string
  readonly choices?: readonly {
    readonly delta?: {
      readonly content?: string | null
      readonly reasoning_content?: string | null
      readonly reasoning?: string | null
      readonly tool_calls?: readonly ChunkToolCall[]
    }
  }[]
}

/**
 * The AG-UI events of one streamed reply. One thing is open at a time, as AG-UI wants: the
 * reasoning, a text message or a tool call is closed before the next begins.
 */
class Translator {
  readonly #runId: string
  #messages = 0
  #textSeen = false
  #open: { readonly kind: 'reasoning' | 'text' | 'tool'; readonly id: string } | undefined
  /** The call each streamed index is filling now. */
  readonly #calls = new Map<number, string>()
  readonly pending: string[] = []

  constructor(runId: string) {
    this.#runId = runId
  }

  /** The assistant message tool calls attach to. */
  get #parentId(): string {
    return `msg_${this.#runId}`
  }

  #close(): AGUIEvent[] {
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
      events.push(...this.#close())
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
      events.push(...this.#close())
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

  toolCall(call: ChunkToolCall): AGUIEvent[] {
    const index = call.index ?? 0
    const known = this.#calls.get(index)
    const events: AGUIEvent[] = []
    // A new id at a known index is a new call: some servers number every call 0.
    const starts = known === undefined || (call.id !== undefined && call.id !== known)
    let id = known ?? ''

    if (starts) {
      events.push(...this.#close())
      id = call.id ?? `call_${this.#runId}_${String(this.pending.length)}`
      this.#calls.set(index, id)
      this.pending.push(id)
      this.#open = { kind: 'tool', id }
      events.push({
        type: EventType.TOOL_CALL_START,
        toolCallId: id,
        toolCallName: call.function?.name ?? 'unknown_tool',
        parentMessageId: this.#parentId,
      })
    }
    const args = call.function?.arguments
    // A late piece of a call already closed cannot be sent; servers stream one call at a time.
    if (args !== undefined && args !== '' && this.#open?.kind === 'tool' && this.#open.id === id) {
      events.push({ type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: args })
    }
    return events
  }

  end(): AGUIEvent[] {
    return this.#close()
  }
}

export function openAiModel(options: OpenAiModelOptions): Model {
  const fetch = options.fetch ?? globalThis.fetch
  const url = completionsUrl(options.baseUrl)

  return async function* run(input, signal) {
    yield runStarted(input)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          ...(options.apiKey === undefined || options.apiKey === ''
            ? {}
            : { authorization: `Bearer ${options.apiKey}` }),
        },
        body: JSON.stringify({
          model: options.model,
          stream: true,
          messages: toChatMessages(input),
          ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
          // An empty list trips some servers' tool parsers, so none is sent without tools.
          ...(input.tools.length === 0
            ? {}
            : {
                tools: input.tools.map(tool => ({
                  type: 'function',
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: (tool.parameters as unknown) ?? { type: 'object', properties: {} },
                  },
                })),
              }),
        }),
      })
    } catch (error) {
      if (!signal.aborted) {
        yield runError(
          `The model at ${url} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      return
    }
    if (!response.ok || response.body === null) {
      yield runError(`The model answered ${String(response.status)}: ${await response.text()}`)
      return
    }

    const translator = new Translator(input.runId)
    const splitter = new ThinkSplitter()
    const content = (delta: string): AGUIEvent[] =>
      splitter
        .push(delta)
        .flatMap(piece =>
          piece.kind === 'reasoning'
            ? translator.reasoning(piece.text)
            : translator.text(piece.text),
        )

    for await (const data of serverSentEvents(response.body)) {
      if (data === '[DONE]') break
      let chunk: Chunk
      try {
        chunk = JSON.parse(data) as Chunk
      } catch {
        continue
      }
      if (chunk.error !== undefined) {
        yield runError(
          typeof chunk.error === 'string'
            ? chunk.error
            : (chunk.error.message ?? 'The model failed.'),
        )
        return
      }
      const delta = chunk.choices?.[0]?.delta
      if (delta === undefined) continue

      const thought = delta.reasoning_content ?? delta.reasoning
      if (typeof thought === 'string') yield* translator.reasoning(thought)
      if (typeof delta.content === 'string') yield* content(delta.content)
      for (const call of delta.tool_calls ?? []) yield* translator.toolCall(call)
    }

    if (signal.aborted) return
    for (const piece of splitter.flush()) {
      yield* piece.kind === 'reasoning'
        ? translator.reasoning(piece.text)
        : translator.text(piece.text)
    }
    yield* translator.end()
    yield runFinished(input, translator.pending)
  }
}
