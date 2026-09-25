import type { Message } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { toUIMessages, type ToolCallProgress } from './message-view.ts'

function assistantCalling(args: string): Message {
  return {
    id: 'a1',
    role: 'assistant',
    toolCalls: [{ id: 'c1', type: 'function', function: { name: 'read_well', arguments: args } }],
  }
}

function stateOf(history: readonly Message[], progress: Record<string, ToolCallProgress> = {}) {
  const [message] = toUIMessages(history, new Map(Object.entries(progress)))
  return message?.parts[0]
}

describe('a tool call’s state', () => {
  it('follows the call from its first event to its result', () => {
    expect(stateOf([assistantCalling('')], { c1: { ended: false } })).toMatchObject({
      state: 'awaiting-input',
    })
    expect(stateOf([assistantCalling('{"wellId":')], { c1: { ended: false } })).toMatchObject({
      state: 'input-streaming',
    })
    expect(stateOf([assistantCalling('{"wellId":"W-1"}')], { c1: { ended: true } })).toMatchObject({
      state: 'input-complete',
      input: { wellId: 'W-1' },
    })
    expect(
      stateOf([assistantCalling('{}')], { c1: { ended: true, approval: { id: 'p1' } } }),
    ).toMatchObject({ state: 'approval-requested', approval: { id: 'p1', needsApproval: true } })
    expect(
      stateOf([assistantCalling('{}')], {
        c1: { ended: true, approval: { id: 'p1', approved: false } },
      }),
    ).toMatchObject({ state: 'approval-responded', approval: { approved: false } })
  })

  it('folds the result into the calling message, parsed when it is JSON', () => {
    const [message] = toUIMessages(
      [
        assistantCalling('{}'),
        { id: 't1', role: 'tool', toolCallId: 'c1', content: '{"status":"producing"}' },
      ],
      new Map(),
    )

    expect(message?.parts).toEqual([
      expect.objectContaining({
        type: 'tool-call',
        state: 'complete',
        output: { status: 'producing' },
      }),
      {
        type: 'tool-result',
        toolCallId: 'c1',
        content: '{"status":"producing"}',
        state: 'complete',
      },
    ])
  })

  it('treats a call from a stored conversation as complete input, and a failed one as an error', () => {
    expect(stateOf([assistantCalling('{}')])).toMatchObject({ state: 'input-complete' })
    expect(
      stateOf([
        assistantCalling('{}'),
        { id: 't1', role: 'tool', toolCallId: 'c1', content: 'no', error: 'Service down' },
      ]),
    ).toMatchObject({ state: 'error', output: 'no' })
  })
})

describe('other messages', () => {
  it('shows reasoning as thinking, and system messages as system', () => {
    expect(
      toUIMessages(
        [
          { id: 's', role: 'system', content: 'Be brief.' },
          { id: 'r', role: 'reasoning', content: 'The user wants W-1.' },
        ],
        new Map(),
      ),
    ).toEqual([
      { id: 's', role: 'system', parts: [{ type: 'text', content: 'Be brief.' }] },
      { id: 'r', role: 'assistant', parts: [{ type: 'thinking', content: 'The user wants W-1.' }] },
    ])
  })
})
