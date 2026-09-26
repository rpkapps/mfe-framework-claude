/**
 * The transcript's view of the stored AG-UI messages, in TanStack AI's `UIMessage` shape: each
 * message with `parts`, a tool's result folded into the message that called it, and each call's
 * state from what the client has seen of it. A function of the history and that state, so the
 * view never drifts from what is kept.
 *
 * The view is made again on every streamed event, so each message's view is remembered with what
 * it was made from: a message none of whose inputs changed keeps its object, and a transcript
 * memoised on it skips the message, and the parsing of its arguments and results, until it does.
 */

import { contentToText, type Message } from '@ag-ui/core'

import type { MessagePart, ToolCallPart, ToolCallState, UIMessage } from './types.ts'

/** What the client knows of a call beyond the stored messages. */
export interface ToolCallProgress {
  /** Its arguments are complete (`TOOL_CALL_END`, or the run that made it has finished). */
  readonly ended: boolean
  readonly approval?: { readonly id: string; readonly approved?: boolean }
}

interface ToolResult {
  readonly content: string
  readonly error?: string
}

/**
 * Everything a message's view is made from, as primitives compared one by one. The AG-UI client
 * streams into its message objects in place, so an object's identity says nothing about whether
 * it changed.
 */
type ViewInputs = readonly unknown[]

interface Remembered {
  readonly inputs: ViewInputs
  readonly view: UIMessage
}

/** Makes the view of a history: `(history, progress) => UIMessage[]`, remembering each message. */
export type MessageView = (
  history: readonly Message[],
  progress: ReadonlyMap<string, ToolCallProgress>,
) => readonly UIMessage[]

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function callState(
  call: { readonly arguments: string },
  progress: ToolCallProgress | undefined,
  result: ToolResult | undefined,
): ToolCallState {
  if (result !== undefined) return result.error === undefined ? 'complete' : 'error'
  if (progress?.approval !== undefined) {
    return progress.approval.approved === undefined ? 'approval-requested' : 'approval-responded'
  }
  // A call the client never saw stream is from a stored history, so it is complete.
  if (progress === undefined || progress.ended) return 'input-complete'
  return call.arguments === '' ? 'awaiting-input' : 'input-streaming'
}

function sameInputs(a: ViewInputs, b: ViewInputs): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
}

/** What `message`'s view is made from, or `undefined` for a message the transcript does not show. */
function inputsOf(
  message: Message,
  results: ReadonlyMap<string, ToolResult>,
  progress: ReadonlyMap<string, ToolCallProgress>,
): ViewInputs | undefined {
  switch (message.role) {
    case 'user':
    case 'system':
    case 'developer':
      return [message.role, contentToText(message.content)]
    case 'reasoning':
      return [message.role, message.content]
    case 'assistant':
      return [
        message.role,
        message.content,
        ...(message.toolCalls ?? []).flatMap(call => {
          const callProgress = progress.get(call.id)
          const result = results.get(call.id)
          return [
            call.id,
            call.function.name,
            call.function.arguments,
            callProgress?.ended,
            callProgress?.approval?.id,
            callProgress?.approval?.approved,
            result?.content,
            result?.error,
          ]
        }),
      ]
    default:
      // A tool's result is folded into its call; activity messages are a later step's.
      return undefined
  }
}

function viewOf(
  message: Message,
  results: ReadonlyMap<string, ToolResult>,
  progress: ReadonlyMap<string, ToolCallProgress>,
): UIMessage | undefined {
  switch (message.role) {
    case 'user':
    case 'system':
    case 'developer':
      return {
        id: message.id,
        role: message.role === 'user' ? 'user' : 'system',
        parts: [{ type: 'text', content: contentToText(message.content) }],
      }
    case 'reasoning':
      return {
        id: message.id,
        role: 'assistant',
        parts: [{ type: 'thinking', content: message.content }],
      }
    case 'assistant': {
      const parts: MessagePart[] = []
      if (message.content !== undefined && message.content !== '') {
        parts.push({ type: 'text', content: message.content })
      }
      for (const call of message.toolCalls ?? []) {
        const callProgress = progress.get(call.id)
        const result = results.get(call.id)
        const state = callState(call.function, callProgress, result)
        const input =
          state === 'awaiting-input' || state === 'input-streaming'
            ? undefined
            : parseJson(call.function.arguments || '{}')
        const approval = callProgress?.approval
        const part: ToolCallPart = {
          type: 'tool-call',
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
          state,
          ...(input === undefined ? {} : { input }),
          ...(approval === undefined
            ? {}
            : {
                approval: {
                  id: approval.id,
                  needsApproval: true,
                  ...(approval.approved === undefined ? {} : { approved: approval.approved }),
                },
              }),
          ...(result === undefined ? {} : { output: parseJson(result.content) ?? result.content }),
        }
        parts.push(part)
        if (result !== undefined) {
          parts.push({
            type: 'tool-result',
            toolCallId: call.id,
            content: result.content,
            state: result.error === undefined ? 'complete' : 'error',
            ...(result.error === undefined ? {} : { error: result.error }),
          })
        }
      }
      return { id: message.id, role: 'assistant', parts }
    }
    default:
      return undefined
  }
}

/**
 * A view that remembers what it made: each message keeps its `UIMessage` while its inputs are
 * unchanged, and the list keeps its array while every message does. One per conversation's owner.
 */
export function createMessageView(): MessageView {
  let remembered = new Map<string, Remembered>()
  let last: readonly UIMessage[] = []

  return (history, progress) => {
    const results = new Map<string, ToolResult>()
    for (const message of history) {
      if (message.role !== 'tool') continue
      results.set(message.toolCallId, {
        content: contentToText(message.content),
        ...(message.error === undefined ? {} : { error: message.error }),
      })
    }

    // Only the messages in this history are kept, so a message cut from it is forgotten.
    const next = new Map<string, Remembered>()
    const view: UIMessage[] = []
    for (const message of history) {
      const inputs = inputsOf(message, results, progress)
      if (inputs === undefined) continue
      let entry = remembered.get(message.id)
      if (entry === undefined || !sameInputs(entry.inputs, inputs)) {
        const made = viewOf(message, results, progress)
        if (made === undefined) continue
        entry = { inputs, view: made }
      }
      next.set(message.id, entry)
      view.push(entry.view)
    }
    remembered = next

    const unchanged =
      view.length === last.length && view.every((message, index) => message === last[index])
    if (!unchanged) last = view
    return last
  }
}

/** The view of a history, made afresh. */
export function toUIMessages(
  history: readonly Message[],
  progress: ReadonlyMap<string, ToolCallProgress>,
): readonly UIMessage[] {
  return createMessageView()(history, progress)
}
