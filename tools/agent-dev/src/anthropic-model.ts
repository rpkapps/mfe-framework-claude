/**
 * A real model for development: Anthropic's Messages API, streamed, translated to AG-UI. Plain
 * `fetch` rather than an SDK or an agent library, because this is a stand-in and the backend a
 * deployment runs is not decided (docs/agentic-plan.md, open questions). Every tool is the page's,
 * so a run that calls tools ends with them pending for the page to answer, as the spec writes it.
 */

import type { AGUIEvent, Message, RunAgentInput } from '@ag-ui/core'
import { EventType } from '@ag-ui/core'

import { runError, runFinished, runStarted, type Model } from './events.ts'

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

const INSTRUCTIONS = [
  'You are the assistant in a workspace shell that hosts several applications (Apps) and Widgets.',
  'Use the tools to act for the user; they run in the page, and the page asks the user before anything that changes data.',
  'Navigate with the navigate tool, show UI with render_widget or the show_* tools, and ask the user with ask_user when you need a decision.',
  'Only show figures you got from a tool or the context: never invent data for a table, a chart or a summary.',
  'Keep answers short.',
].join(' ')

function textOf(message: Message): string {
  if (!('content' in message)) return ''
  const { content } = message
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as unknown[])
    .map(part =>
      typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string'
        ? part.text
        : '',
    )
    .join('')
}

function parseInput(text: string): unknown {
  try {
    return JSON.parse(text === '' ? '{}' : text) as unknown
  } catch {
    return {}
  }
}

/** AG-UI history as Anthropic messages: tool results are user turns, and turns alternate. */
export function toAnthropic(input: RunAgentInput): {
  readonly system: string
  readonly messages: AnthropicMessage[]
} {
  const system = [INSTRUCTIONS]
  if (input.context.length > 0) {
    system.push(
      'What the page says about where the user is and what they selected:',
      ...input.context.map(entry => `- ${entry.description}: ${entry.value}`),
    )
  }

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

/** Server-sent events, one parsed `data:` payload at a time. */
async function* serverSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder()
  let buffered = ''
  for await (const chunk of body) {
    buffered += decoder.decode(chunk, { stream: true })
    let end = buffered.indexOf('\n\n')
    while (end !== -1) {
      const frame = buffered.slice(0, end)
      buffered = buffered.slice(end + 2)
      const data = frame
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
      if (data !== '') yield JSON.parse(data) as unknown
      end = buffered.indexOf('\n\n')
    }
  }
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

    for await (const raw of serverSentEvents(response.body)) {
      const event = raw as StreamEvent
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
