/**
 * Where a tool call is, in the three stages every call renders (agentic plan, E): its inputs
 * arriving, running (or waiting on the user's approval), and done with its result. Kept apart from
 * the components so React Refresh can replace those in place (§18).
 */

import type { ToolCallPart } from '@company/mfe-agent'
import { isObject } from './records.ts'

export type ToolStage = 'preparing' | 'approval' | 'running' | 'done' | 'declined' | 'failed'

/** What a result says about how it went: every page tool answers with a `status`. */
function outcome(output: unknown): ToolStage {
  if (!isObject(output)) return 'done'
  if ('error' in output && !('status' in output)) return 'failed'
  switch (output['status']) {
    case 'declined':
    case 'denied':
    case 'blocked':
    case 'cancelled':
      return 'declined'
    case 'invalid':
    case 'unavailable':
    case 'failed':
      return 'failed'
    default:
      return 'done'
  }
}

export function stageOf(part: ToolCallPart): ToolStage {
  switch (part.state) {
    case 'awaiting-input':
    case 'input-streaming':
      return 'preparing'
    case 'approval-requested':
      return 'approval'
    case 'approval-responded':
      return part.approval?.approved === false ? 'declined' : 'running'
    case 'input-complete':
      return 'running'
    case 'error':
      return 'failed'
    case 'complete':
      return outcome(part.output)
  }
}

export const STAGE_TEXT: Readonly<Record<ToolStage, string>> = {
  preparing: 'Preparing',
  approval: 'Needs your approval',
  running: 'Running',
  done: 'Done',
  declined: 'Not done',
  failed: 'Failed',
}

/** Why a finished call did not do what it was asked, from its result, when the result says. */
export function reasonOf(output: unknown): string | undefined {
  if (!isObject(output)) return undefined
  if (typeof output['reason'] === 'string') return output['reason']
  const error = output['error']
  if (typeof error === 'string') return error
  if (isObject(error) && typeof error['message'] === 'string') return error['message']
  return undefined
}

/** `shut_in_well` → "Shut in well", for a backend tool the page knows only by name. */
export function humanize(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim()
  return words === '' ? name : `${words[0]?.toUpperCase() ?? ''}${words.slice(1)}`
}
