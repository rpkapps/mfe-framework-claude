/**
 * A real model for development through any OpenAI-compatible chat completions endpoint: a model on
 * your own machine or network behind vLLM, SGLang, llama.cpp's server, Ollama or LM Studio, or a
 * hosted one. Streamed, and translated to AG-UI through the `Reply` the Anthropic adapter uses too. Every tool is the
 * page's, so a run that calls tools ends with them pending for the page to answer.
 *
 * A reasoning model's thinking arrives as `reasoning_content` (DeepSeek's field, which vLLM and
 * SGLang also use), as `reasoning`, or inline between `<think>` tags when the server does not
 * split it out; all three become AG-UI reasoning, which the chat shows as "Thinking". It is never
 * sent back to the model.
 */

import type { AGUIEvent, RunAgentInput } from '@ag-ui/core'

import type { Model } from './events.ts'
import { systemPrompt, textOf } from './prompt.ts'
import { Reply, streamedRun, type StreamReader } from './reply.ts'

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

/** Chat completions chunks read into a reply: reasoning, text split at `<think>`, tool calls. */
export function chunkReader(runId: string): StreamReader {
  const reply = new Reply(runId)
  const splitter = new ThinkSplitter()
  /** The call each streamed index is filling now. */
  const calls = new Map<number, string>()
  const content = (pieces: ReturnType<ThinkSplitter['push']>): AGUIEvent[] =>
    pieces.flatMap(piece =>
      piece.kind === 'reasoning' ? reply.reasoning(piece.text) : reply.text(piece.text),
    )

  const toolCall = (call: ChunkToolCall): AGUIEvent[] => {
    const index = call.index ?? 0
    const given = call.id === undefined || call.id === '' ? undefined : call.id
    let id = calls.get(index)
    const events: AGUIEvent[] = []
    // Some servers repeat the id on every piece, some send it once; a new id at a known index is a
    // new call, since some servers number every call 0.
    if (id === undefined || (given !== undefined && given !== id)) {
      const started = reply.toolCall(given, call.function?.name)
      id = started.id
      calls.set(index, id)
      events.push(...started.events)
    }
    events.push(...reply.toolArgs(id, call.function?.arguments ?? ''))
    return events
  }

  return {
    read(payload) {
      const chunk = payload as Chunk
      if (chunk.error !== undefined) {
        return {
          error:
            typeof chunk.error === 'string'
              ? chunk.error
              : (chunk.error.message ?? 'The model failed.'),
        }
      }
      const delta = chunk.choices?.[0]?.delta
      if (delta === undefined) return []
      const thought = delta.reasoning_content ?? delta.reasoning
      return [
        ...(typeof thought === 'string' ? reply.reasoning(thought) : []),
        ...(typeof delta.content === 'string' ? content(splitter.push(delta.content)) : []),
        ...(delta.tool_calls ?? []).flatMap(toolCall),
      ]
    },
    end() {
      return [...content(splitter.flush()), ...reply.close()]
    },
    pending: reply.pending,
  }
}

export function openAiModel(options: OpenAiModelOptions): Model {
  const url = completionsUrl(options.baseUrl)

  return (input, signal) =>
    streamedRun(
      input,
      signal,
      {
        url,
        fetch: options.fetch ?? globalThis.fetch,
        headers:
          options.apiKey === undefined || options.apiKey === ''
            ? {}
            : { authorization: `Bearer ${options.apiKey}` },
        body: {
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
        },
      },
      chunkReader(input.runId),
    )
}
