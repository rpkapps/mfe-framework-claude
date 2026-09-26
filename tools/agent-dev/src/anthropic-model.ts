/**
 * A real model for development: Anthropic's Messages API, streamed, translated to AG-UI. Plain
 * `fetch` rather than an SDK or an agent library, because this is a stand-in and the backend a
 * deployment runs is not decided (docs/agentic-plan.md, open questions). Every tool is the page's,
 * so a run that calls tools ends with them pending for the page to answer, as the spec writes it.
 */

import type { RunAgentInput } from '@ag-ui/core'

import type { Model } from './events.ts'
import { parseInput, systemPrompt, textOf } from './prompt.ts'
import { Reply, streamedRun, type StreamReader } from './reply.ts'

export interface AnthropicModelOptions {
  readonly apiKey: string
  /** The model id, from `AGENT_DEV_MODEL`. */
  readonly model: string
  readonly maxTokens?: number
  readonly fetch?: typeof globalThis.fetch
  readonly baseUrl?: string
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: Block[]
}

/** AG-UI history as Anthropic messages: tool results are user turns, and turns alternate. */
export function toAnthropic(input: RunAgentInput): {
  readonly system: string
  readonly messages: AnthropicMessage[]
} {
  const system = [systemPrompt(input)]

  const messages: AnthropicMessage[] = []
  const push = (role: AnthropicMessage['role'], blocks: Block[]): void => {
    if (blocks.length === 0) return
    const previous = messages.at(-1)
    if (previous?.role === role) previous.content.push(...blocks)
    else messages.push({ role, content: blocks })
  }

  for (const message of input.messages) {
    switch (message.role) {
      case 'user': {
        const text = textOf(message)
        if (text !== '') push('user', [{ type: 'text', text }])
        break
      }
      case 'assistant': {
        const blocks: Block[] = []
        const text = textOf(message)
        if (text !== '') blocks.push({ type: 'text', text })
        for (const call of message.toolCalls ?? []) {
          blocks.push({
            type: 'tool_use',
            id: call.id,
            name: call.function.name,
            input: parseInput(call.function.arguments),
          })
        }
        push('assistant', blocks)
        break
      }
      case 'tool':
        push('user', [
          {
            type: 'tool_result',
            tool_use_id: message.toolCallId,
            content: textOf(message),
            ...(message.error === undefined ? {} : { is_error: true }),
          },
        ])
        break
      case 'system':
      case 'developer':
        system.push(textOf(message))
        break
      default:
        break
    }
  }

  return { system: system.join('\n'), messages }
}

interface StreamEvent {
  readonly type: string
  readonly index?: number
  readonly content_block?: { readonly type: string; readonly id?: string; readonly name?: string }
  readonly delta?: {
    readonly type: string
    readonly text?: string
    readonly partial_json?: string
  }
  readonly error?: { readonly message?: string }
}

/**
 * Messages API stream events read into a reply. Content blocks come one at a time: a text block's
 * deltas are text, a `tool_use` block's are its arguments, and each block's stop closes it.
 */
export function streamEventReader(runId: string): StreamReader {
  const reply = new Reply(runId)
  /** The call each `tool_use` block is. */
  const calls = new Map<number, string>()

  return {
    read(payload) {
      const event = payload as StreamEvent
      const index = event.index ?? 0
      switch (event.type) {
        case 'content_block_start': {
          const block = event.content_block
          if (block?.type !== 'tool_use') return []
          const { id, events } = reply.toolCall(block.id, block.name)
          calls.set(index, id)
          return events
        }
        case 'content_block_delta': {
          const delta = event.delta
          if (delta?.type === 'text_delta') return reply.text(delta.text ?? '')
          const call = calls.get(index)
          if (delta?.type === 'input_json_delta' && call !== undefined) {
            return reply.toolArgs(call, delta.partial_json ?? '')
          }
          return []
        }
        case 'content_block_stop':
          return reply.close()
        case 'error':
          return { error: event.error?.message ?? 'The model failed.' }
        default:
          return []
      }
    },
    end() {
      return reply.close()
    },
    pending: reply.pending,
  }
}

export function anthropicModel(options: AnthropicModelOptions): Model {
  const baseUrl = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '')

  return (input, signal) => {
    const { system, messages } = toAnthropic(input)
    return streamedRun(
      input,
      signal,
      {
        url: `${baseUrl}/v1/messages`,
        fetch: options.fetch ?? globalThis.fetch,
        headers: { 'x-api-key': options.apiKey, 'anthropic-version': '2023-06-01' },
        body: {
          model: options.model,
          max_tokens: options.maxTokens ?? 4096,
          stream: true,
          system,
          messages,
          tools: input.tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: (tool.parameters as unknown) ?? { type: 'object', properties: {} },
          })),
        },
      },
      streamEventReader(input.runId),
    )
  }
}
