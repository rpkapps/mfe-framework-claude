/**
 * The transcript's view of the stored AG-UI messages, in TanStack AI's `UIMessage` shape: each
 * message with `parts`, a tool's result folded into the message that called it, and each call's
 * state from what the client has seen of it. A pure function of the history and that state, so the
 * view never drifts from what is kept.
 */

import { contentToText, type Message } from '@ag-ui/core'

import type { MessagePart, ToolCallPart, ToolCallState, UIMessage } from './types.ts'

/** What the client knows of a call beyond the stored messages. */
export interface ToolCallProgress {
  /** Its arguments are complete (`TOOL_CALL_END`, or the run that made it has finished). */
  readonly ended: boolean
  readonly approval?: { readonly id: string; readonly approved?: boolean }
}

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
  result: { readonly error?: string } | undefined,
): ToolCallState {
  if (result !== undefined) return result.error === undefined ? 'complete' : 'error'
  if (progress?.approval !== undefined) {
    return progress.approval.approved === undefined ? 'approval-requested' : 'approval-responded'
  }
  // A call the client never saw stream is from a stored history, so it is complete.
  if (progress === undefined || progress.ended) return 'input-complete'
  return call.arguments === '' ? 'awaiting-input' : 'input-streaming'
}

export function toUIMessages(
  history: readonly Message[],
  progress: ReadonlyMap<string, ToolCallProgress>,
): UIMessage[] {
  const results = new Map<string, { readonly content: string; readonly error?: string }>()
  for (const message of history) {
    if (message.role !== 'tool') continue
    results.set(message.toolCallId, {
      content: contentToText(message.content),
      ...(message.error === undefined ? {} : { error: message.error }),
    })
  }

  const view: UIMessage[] = []
  for (const message of history) {
    switch (message.role) {
      case 'user':
      case 'system':
      case 'developer':
        view.push({
          id: message.id,
          role: message.role === 'user' ? 'user' : 'system',
          parts: [{ type: 'text', content: contentToText(message.content) }],
        })
        break
      case 'reasoning':
        view.push({
          id: message.id,
          role: 'assistant',
          parts: [{ type: 'thinking', content: message.content }],
        })
        break
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
            ...(result === undefined
              ? {}
              : { output: parseJson(result.content) ?? result.content }),
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
        view.push({ id: message.id, role: 'assistant', parts })
        break
      }
      default:
        // A tool's result is folded into its call above; activity messages are a later step's.
        break
    }
  }
  return view
}
