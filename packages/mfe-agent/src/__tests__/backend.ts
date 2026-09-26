/**
 * An AG-UI backend in process, answering each run from a script, with the events a spec producer
 * sends. The requests it received are kept for the assertions.
 */

import { EventType, type AGUIEvent, type Interrupt, type RunAgentInput } from '@ag-ui/core'

import { fetchServerSentEvents, type ChatConnection } from '../connection.ts'

export type Reply = (input: RunAgentInput, index: number) => AGUIEvent[]

export interface ScriptedBackend {
  readonly connection: ChatConnection
  readonly requests: readonly RunAgentInput[]
}

export function scriptedBackend(...replies: Reply[]): ScriptedBackend {
  const requests: RunAgentInput[] = []
  return {
    connection: fetchServerSentEvents('http://agent.test/run', {
      fetch: (_url, init) => {
        const input = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as RunAgentInput
        requests.push(input)
        const reply = replies[requests.length - 1] ?? replies.at(-1) ?? (() => [])
        const events = reply(input, requests.length - 1)
        const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
        return Promise.resolve(
          new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
        )
      },
    }),
    requests,
  }
}

const started = ({ threadId, runId }: RunAgentInput): AGUIEvent => ({
  type: EventType.RUN_STARTED,
  threadId,
  runId,
})

/** The assistant says `text` and the run ends. */
export function says(text: string): Reply {
  return input => [
    started(input),
    { type: EventType.TEXT_MESSAGE_START, messageId: `m-${input.runId}`, role: 'assistant' },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: `m-${input.runId}`, delta: text },
    { type: EventType.TEXT_MESSAGE_END, messageId: `m-${input.runId}` },
    { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId },
  ]
}

export interface Call {
  readonly id: string
  readonly name: string
  readonly args: Record<string, unknown>
}

function callEvents(toolCalls: readonly Call[]): AGUIEvent[] {
  return toolCalls.flatMap((call): AGUIEvent[] => [
    { type: EventType.TOOL_CALL_START, toolCallId: call.id, toolCallName: call.name },
    { type: EventType.TOOL_CALL_ARGS, toolCallId: call.id, delta: JSON.stringify(call.args) },
    { type: EventType.TOOL_CALL_END, toolCallId: call.id },
  ])
}

/** The assistant calls tools and the run ends with them pending, as a spec producer ends it. */
export function calls(...toolCalls: Call[]): Reply {
  return input => [
    started(input),
    ...callEvents(toolCalls),
    {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
      outcome: { type: 'success', pendingToolCallIds: toolCalls.map(call => call.id) },
    },
  ]
}

/** The assistant calls tools, and the run stops on interrupts. */
export function interrupts(toolCalls: readonly Call[], ...raised: Interrupt[]): Reply {
  return input => [
    started(input),
    ...callEvents(toolCalls),
    {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
      outcome: { type: 'interrupt', interrupts: raised },
    },
  ]
}

export function fails(message: string): Reply {
  return input => [started(input), { type: EventType.RUN_ERROR, message }]
}
