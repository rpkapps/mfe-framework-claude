/**
 * A real model for development: Anthropic's Messages API, streamed, translated to AG-UI. Plain
 * `fetch` rather than an SDK or an agent library, because this is a stand-in and the backend a
 * deployment runs is not decided (docs/agentic-plan.md, open questions). Every tool is the page's,
 * so a run that calls tools ends with them pending for the page to answer, as the spec writes it.
 */

import type { AGUIEvent, RunAgentInput } from '@ag-ui/core'
import { EventType } from '@ag-ui/core'

import { runError, runFinished, runStarted, type Model } from './events.ts'
import { parseInput, systemPrompt, textOf } from './prompt.ts'
import { serverSentEvents } from './sse.ts'

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

type StreamEvent =
  | { type: 'message_start'; message: { id: string } }
  | {
      type: 'content_block_start'
      index: number
      content_block:
        { type: 'text' } | { type: 'tool_use'; id: string; name: string } | { type: string }
    }
  | {
      type: 'content_block_delta'
      index: number
      delta:
        | { type: 'text_delta'; text: string }
        | { type: 'input_json_delta'; partial_json: string }
        | { type: string }
    }
  | { type: 'content_block_stop'; index: number }
  | { type: 'error'; error: { message: string } }
  | { type: string }

export function anthropicModel(options: AnthropicModelOptions): Model {
  const fetch = options.fetch ?? globalThis.fetch
  const baseUrl = options.baseUrl ?? 'https://api.anthropic.com'

  return async function* run(input, signal) {
    yield runStarted(input)
    const { system, messages } = toAnthropic(input)

    let response: Response
    try {
      response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
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
        }),
      })
    } catch (error) {
      if (!signal.aborted) yield runError(error instanceof Error ? error.message : String(error))
      return
    }
    if (!response.ok || response.body === null) {
      yield runError(`The model answered ${String(response.status)}: ${await response.text()}`)
      return
    }

    let messageId = `msg_${input.runId}`
    /** What each content block became: a text message, or a tool call. */
    const blocks = new Map<number, { readonly kind: 'text' | 'tool'; readonly id: string }>()
    const pending: string[] = []

    for await (const data of serverSentEvents(response.body)) {
      const event = JSON.parse(data) as StreamEvent
      const out: AGUIEvent[] = []
      if (event.type === 'message_start' && 'message' in event) {
        messageId = event.message.id
      } else if (event.type === 'content_block_start' && 'content_block' in event) {
        const block = event.content_block
        if (block.type === 'text') {
          const id = blocks.size === 0 ? messageId : `${messageId}_${String(event.index)}`
          blocks.set(event.index, { kind: 'text', id })
          out.push({ type: EventType.TEXT_MESSAGE_START, messageId: id, role: 'assistant' })
        } else if (block.type === 'tool_use' && 'id' in block) {
          blocks.set(event.index, { kind: 'tool', id: block.id })
          pending.push(block.id)
          out.push({
            type: EventType.TOOL_CALL_START,
            toolCallId: block.id,
            toolCallName: block.name,
            parentMessageId: messageId,
          })
        }
      } else if (event.type === 'content_block_delta' && 'delta' in event) {
        const block = blocks.get(event.index)
        const { delta } = event
        if (block?.kind === 'text' && 'text' in delta && delta.text !== '') {
          out.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: block.id, delta: delta.text })
        } else if (block?.kind === 'tool' && 'partial_json' in delta && delta.partial_json !== '') {
          out.push({
            type: EventType.TOOL_CALL_ARGS,
            toolCallId: block.id,
            delta: delta.partial_json,
          })
        }
      } else if (event.type === 'content_block_stop' && 'index' in event) {
        const block = blocks.get(event.index)
        if (block?.kind === 'text')
          out.push({ type: EventType.TEXT_MESSAGE_END, messageId: block.id })
        if (block?.kind === 'tool')
          out.push({ type: EventType.TOOL_CALL_END, toolCallId: block.id })
      } else if (event.type === 'error' && 'error' in event) {
        yield runError(event.error.message)
        return
      }
      yield* out
    }

    if (!signal.aborted) yield runFinished(input, pending)
  }
}
