import type { Message } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { limitHistory } from './history.ts'

/** A turn: the user asks, the agent calls a tool after thinking, gets `size` characters, answers. */
function turn(index: number, size: number): Message[] {
  return [
    { id: `u${String(index)}`, role: 'user', content: `Question ${String(index)}` },
    { id: `r${String(index)}`, role: 'reasoning', content: 'Thinking it over.' },
    {
      id: `a${String(index)}`,
      role: 'assistant',
      toolCalls: [
        {
          id: `c${String(index)}`,
          type: 'function',
          function: { name: 'query_wells', arguments: '{}' },
        },
      ],
    },
    {
      id: `t${String(index)}`,
      role: 'tool',
      toolCallId: `c${String(index)}`,
      content: 'x'.repeat(size),
    },
    { id: `m${String(index)}`, role: 'assistant', content: `Answer ${String(index)}` },
  ]
}

function conversation(turns: number, size: number): Message[] {
  return Array.from({ length: turns }, (_, index) => turn(index, size)).flat()
}

const toolContent = (messages: readonly Message[], id: string) =>
  messages.find(message => message.id === id)?.content

describe('limitHistory', () => {
  it('sends a conversation of no more than keepTurns turns whole', () => {
    const messages = conversation(6, 50_000)

    expect(limitHistory(messages)).toEqual(messages)
  })

  it('shortens the big results and drops the reasoning of the turns before the last keepTurns', () => {
    const messages = conversation(8, 12_345)

    const sent = limitHistory(messages)

    expect(toolContent(sent, 't0')).toBe(
      '[Result omitted from this request: 12,345 characters. Call the tool again if it is needed.]',
    )
    expect(toolContent(sent, 't1')).toMatch(/^\[Result omitted/)
    expect(sent.map(message => message.id)).not.toContain('r0')
    expect(sent.map(message => message.id)).not.toContain('r1')
    // The last six turns, from `u2` on, are the same messages.
    expect(sent.slice(sent.findIndex(message => message.id === 'u2'))).toEqual(messages.slice(10))
    // Nothing else is dropped, and the ids stay.
    expect(sent.map(message => message.id)).toEqual(
      messages.map(message => message.id).filter(id => id !== 'r0' && id !== 'r1'),
    )
  })

  it('keeps every call with its result', () => {
    const sent = limitHistory(conversation(10, 5000), { keepTurns: 2 })

    const calls = sent.flatMap(message =>
      message.role === 'assistant' ? (message.toolCalls ?? []).map(call => call.id) : [],
    )
    const results = sent.flatMap(message => (message.role === 'tool' ? [message.toolCallId] : []))
    expect(results).toEqual(calls)
    expect(calls).toHaveLength(10)
  })

  it('keeps a result of maxToolResultChars characters, and shortens one longer', () => {
    const messages = [...turn(0, 100), ...turn(1, 101), ...turn(2, 10)]

    const sent = limitHistory(messages, { keepTurns: 1, maxToolResultChars: 100 })

    expect(toolContent(sent, 't0')).toBe('x'.repeat(100))
    expect(toolContent(sent, 't1')).toMatch(/^\[Result omitted from this request: 101 characters/)
  })

  it('measures a result in parts by its JSON, and drops the artefact of one it shortens', () => {
    const [user, , call] = turn(0, 0)
    if (user === undefined || call === undefined) throw new Error('No turn')
    const messages: Message[] = [
      user,
      call,
      {
        id: 't0',
        role: 'tool',
        toolCallId: 'c0',
        content: [{ type: 'text', text: 'y'.repeat(3000) }],
        encryptedValue: 'opaque',
      },
      ...turn(1, 10),
    ]

    const sent = limitHistory(messages, { keepTurns: 1 })

    expect(sent[2]).toEqual({
      id: 't0',
      role: 'tool',
      toolCallId: 'c0',
      content: expect.stringMatching(
        /^\[Result omitted from this request: 3,0\d\d characters/,
      ) as unknown,
    })
  })

  it('always sends the turn being run whole, and what came before the first turn', () => {
    const system: Message = { id: 's', role: 'system', content: 'You help operators.' }
    const messages = [system, ...conversation(3, 5000)]

    const sent = limitHistory(messages, { keepTurns: 0 })

    expect(sent[0]).toBe(system)
    expect(sent.slice(-5)).toEqual(messages.slice(-5))
    expect(toolContent(sent, 't1')).toMatch(/^\[Result omitted/)
  })

  it('changes nothing with keepTurns Infinity', () => {
    const messages = conversation(20, 5000)

    expect(limitHistory(messages, { keepTurns: Infinity })).toEqual(messages)
  })

  it('leaves the messages it is given as they were', () => {
    const messages = conversation(8, 5000)
    const before = structuredClone(messages)

    limitHistory(messages)

    expect(messages).toEqual(before)
  })
})
