/**
 * The AG-UI events a run is made of, as the spec writes them: what any backend sends, and all
 * the shell reads (docs/decisions.md §49).
 */

import { EventType, type AGUIEvent, type Interrupt, type RunAgentInput } from '@ag-ui/core'

/** A model: the events of one run, given its input. Stopped when the client goes away. */
export type Model = (input: RunAgentInput, signal: AbortSignal) => AsyncIterable<AGUIEvent>

export function runStarted({ threadId, runId }: RunAgentInput): AGUIEvent {
  return { type: EventType.RUN_STARTED, threadId, runId }
}

/** The run ended; `pending` names the calls it left for the page to answer. */
export function runFinished(
  { threadId, runId }: RunAgentInput,
  pending: readonly string[] = [],
): AGUIEvent {
  return {
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
    outcome: {
      type: 'success',
      ...(pending.length === 0 ? {} : { pendingToolCallIds: [...pending] }),
    },
  }
}

export function runInterrupted(
  { threadId, runId }: RunAgentInput,
  interrupts: readonly Interrupt[],
): AGUIEvent {
  return {
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
    outcome: { type: 'interrupt', interrupts: [...interrupts] },
  }
}

export function runError(message: string): AGUIEvent {
  return { type: EventType.RUN_ERROR, message }
}

/** A text message, a few words per event, as a model streams it. */
export function textMessage(messageId: string, text: string): AGUIEvent[] {
  const chunks = text.match(/\S+\s*|\s+/g) ?? []
  const deltas: string[] = []
  for (let index = 0; index < chunks.length; index += 3) {
    deltas.push(chunks.slice(index, index + 3).join(''))
  }
  return [
    { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' },
    ...deltas.map((delta): AGUIEvent => ({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta,
    })),
    { type: EventType.TEXT_MESSAGE_END, messageId },
  ]
}

/** A tool call whose arguments stream in pieces, so the page shows them arriving. */
export function toolCall(
  toolCallId: string,
  toolCallName: string,
  args: unknown,
  parentMessageId?: string,
): AGUIEvent[] {
  const json = JSON.stringify(args)
  const size = Math.max(16, Math.ceil(json.length / 6))
  const deltas: string[] = []
  for (let index = 0; index < json.length; index += size)
    deltas.push(json.slice(index, index + size))
  return [
    {
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName,
      ...(parentMessageId === undefined ? {} : { parentMessageId }),
    },
    ...deltas.map((delta): AGUIEvent => ({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta })),
    { type: EventType.TOOL_CALL_END, toolCallId },
  ]
}

/** The result of the backend's own tool, which it answers itself. */
export function toolResult(messageId: string, toolCallId: string, content: unknown): AGUIEvent {
  return {
    type: EventType.TOOL_CALL_RESULT,
    messageId,
    toolCallId,
    content: typeof content === 'string' ? content : JSON.stringify(content),
  }
}
