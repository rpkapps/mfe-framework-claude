/**
 * A model that answers from a script, so the spike needs no provider and no key: it calls a tool
 * when the user asks for what the tool does, and reports a tool's result as its answer.
 */

import {
  EventType,
  type AdapterYieldChunk,
  type DefaultMessageMetadataByModality,
  type ModelMessage,
  type TextOptions,
} from '@tanstack/ai'
import { BaseTextAdapter, type StructuredOutputResult } from '@tanstack/ai/adapters'

export type ScriptedReply =
  | { readonly text: string }
  | { readonly call: { readonly tool: string; readonly input: Record<string, unknown> } }

/** What the model says next, given the conversation and the names of the tools it was given. */
export type Script = (messages: readonly ModelMessage[], tools: readonly string[]) => ScriptedReply

/**
 * The spike's script: "acknowledge" calls the page's acknowledge action, "shut in" calls the
 * backend's own tool, and a tool result is repeated back as the answer.
 */
export const operationsScript: Script = (messages, tools) => {
  const last = messages.at(-1)
  if (last?.role === 'tool') {
    return { text: `Done: ${typeof last.content === 'string' ? last.content : ''}` }
  }
  const text = typeof last?.content === 'string' ? last.content : ''
  const tool = (part: string): string | undefined => tools.find(name => name.includes(part))
  const acknowledge = tool('acknowledge')
  const shutIn = tool('shut_in')
  if (text.includes('acknowledge') && acknowledge !== undefined) {
    return { call: { tool: acknowledge, input: { alertId: 'A-7' } } }
  }
  if (text.includes('shut in') && shutIn !== undefined) {
    return { call: { tool: shutIn, input: { wellId: 'W-1' } } }
  }
  return { text: 'I have no tool for that.' }
}

export class ScriptedModel extends BaseTextAdapter<
  'scripted',
  Record<string, never>,
  readonly ['text'],
  DefaultMessageMetadataByModality
> {
  readonly name = 'scripted'
  readonly #script: Script
  #ids = 0

  constructor(script: Script) {
    super({}, 'scripted')
    this.#script = script
  }

  async *chatStream(options: TextOptions<Record<string, never>>): AsyncIterable<AdapterYieldChunk> {
    await Promise.resolve()
    const runId = options.runId ?? this.#id('run')
    const threadId = options.threadId ?? 'thread'
    const timestamp = Date.now()
    const reply = this.#script(
      options.messages,
      (options.tools ?? []).map((tool: { readonly name: string }) => tool.name),
    )

    yield { type: EventType.RUN_STARTED, runId, threadId, timestamp }
    if ('call' in reply) {
      const toolCallId = this.#id('call')
      const toolCallName = reply.call.tool
      yield {
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName,
        toolName: toolCallName,
        index: 0,
        timestamp,
      }
      yield {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: JSON.stringify(reply.call.input),
        timestamp,
      }
      yield {
        type: EventType.TOOL_CALL_END,
        toolCallId,
        toolCallName,
        toolName: toolCallName,
        timestamp,
      }
      yield { type: EventType.RUN_FINISHED, runId, threadId, finishReason: 'tool_calls', timestamp }
      return
    }

    const messageId = this.#id('message')
    yield { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant', timestamp }
    yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: reply.text, timestamp }
    yield { type: EventType.TEXT_MESSAGE_END, messageId, timestamp }
    yield { type: EventType.RUN_FINISHED, runId, threadId, finishReason: 'stop', timestamp }
  }

  structuredOutput(): Promise<StructuredOutputResult> {
    return Promise.reject(new Error('The scripted model has no structured output.'))
  }

  #id(prefix: string): string {
    this.#ids += 1
    return `${prefix}_${String(this.#ids)}`
  }
}
