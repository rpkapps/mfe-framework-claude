import type { ToolCallPart } from '@company/mfe-agent'
import { describe, expect, it } from 'vitest'

import { humanize, reasonOf, stageOf } from './tool-stage.ts'

const part = (fields: Partial<ToolCallPart>): ToolCallPart => ({
  type: 'tool-call',
  id: 'c',
  name: 'n',
  arguments: '',
  state: 'input-complete',
  ...fields,
})

describe('stageOf', () => {
  it.each([
    [part({ state: 'input-streaming' }), 'preparing'],
    [part({ state: 'approval-requested' }), 'approval'],
    [
      part({
        state: 'approval-responded',
        approval: { id: 'a', needsApproval: true, approved: false },
      }),
      'declined',
    ],
    [
      part({
        state: 'approval-responded',
        approval: { id: 'a', needsApproval: true, approved: true },
      }),
      'running',
    ],
    [part({ state: 'input-complete' }), 'running'],
    [part({ state: 'complete', output: { status: 'executed' } }), 'done'],
    [part({ state: 'complete', output: { status: 'declined', reason: 'No' } }), 'declined'],
    [part({ state: 'complete', output: { status: 'blocked' } }), 'declined'],
    [part({ state: 'complete', output: { status: 'cancelled', reason: 'Stopped' } }), 'declined'],
    [part({ state: 'complete', output: { status: 'unavailable' } }), 'failed'],
    [part({ state: 'complete', output: { error: 'The arguments are not JSON.' } }), 'failed'],
    [part({ state: 'error' }), 'failed'],
  ])('%#: %s', (call, stage) => {
    expect(stageOf(call)).toBe(stage)
  })
})

describe('reasonOf and humanize', () => {
  it('reads why a call did not happen, and names a tool the page does not know', () => {
    expect(reasonOf({ status: 'denied', reason: 'Signed out' })).toBe('Signed out')
    expect(reasonOf({ status: 'failed', error: { code: 'x', message: 'Broke' } })).toBe('Broke')
    expect(humanize('shut_in_well')).toBe('Shut in well')
  })
})
