import { describe, expect, it } from 'vitest'
import type { UIMessage } from '@company/mfe-agent'

import { turnsOf } from './transcript.tsx'

function message(id: string, role: UIMessage['role']): UIMessage {
  return { id, role, parts: [] }
}

describe('turnsOf', () => {
  it('starts a turn at each question and keeps its answers with it', () => {
    const turns = turnsOf([
      message('a', 'assistant'),
      message('u1', 'user'),
      message('r1', 'assistant'),
      message('r2', 'assistant'),
      message('u2', 'user'),
    ])

    expect(turns.map(turn => [turn.id, turn.asked, turn.messages.map(m => m.id)])).toEqual([
      ['a', false, ['a']],
      ['u1', true, ['u1', 'r1', 'r2']],
      ['u2', true, ['u2']],
    ])
  })

  it('has no turns before the first message', () => {
    expect(turnsOf([])).toEqual([])
  })
})
