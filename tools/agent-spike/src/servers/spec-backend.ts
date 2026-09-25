/**
 * A backend that speaks AG-UI 1.0 exactly as the spec writes it and nothing more, as Agent
 * Framework's host does: a page tool call ends the run with `success` and the call left pending,
 * and the next run carries the page's answer as a tool message. It stands in for any backend that
 * is not TanStack AI, so the comparison runs without .NET.
 */

import { EventType, type AGUIEvent, type RunAgentInput } from '@ag-ui/core'

export interface SpecBackend {
  readonly url: string
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>
  readonly requests: readonly RunAgentInput[]
}

function sse(events: readonly AGUIEvent[]): Response {
  const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

/** Calls the first page tool whose name has `acknowledge` in it, then reports its result. */
export function createSpecBackend(): SpecBackend {
  const requests: RunAgentInput[] = []

  function reply(input: RunAgentInput): AGUIEvent[] {
    const { threadId, runId } = input
    const last = input.messages.at(-1)
    const tool = input.tools.find(candidate => candidate.name.includes('acknowledge'))
    const opened: AGUIEvent = { type: EventType.RUN_STARTED, threadId, runId }

    if (last?.role === 'user' && tool !== undefined) {
      const toolCallId = `call_${String(requests.length)}`
      return [
        opened,
        { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: tool.name },
        { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: '{"alertId":"A-7"}' },
        { type: EventType.TOOL_CALL_END, toolCallId },
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId,
          outcome: { type: 'success', pendingToolCallIds: [toolCallId] },
        },
      ]
    }

    const messageId = `message_${String(requests.length)}`
    const text =
      last?.role === 'tool' && typeof last.content === 'string'
        ? `Done: ${last.content}`
        : 'I have no tool for that.'
    return [
      opened,
      { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text },
      { type: EventType.TEXT_MESSAGE_END, messageId },
      { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: 'success' } },
    ]
  }

  return {
    url: 'http://spec.test/agent',
    fetch: (_url, init) => {
      const input = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as RunAgentInput
      requests.push(input)
      return Promise.resolve(sse(reply(input)))
    },
    requests,
  }
}
