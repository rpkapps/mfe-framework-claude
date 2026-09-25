import { describe, expect, it } from 'vitest'

import {
  actionEntryEqual,
  allow,
  arrayEqual,
  jsonEqual,
  shallowEqual,
  type ActionEntry,
} from './records.ts'

describe('equality helpers', () => {
  it('shallowEqual compares own enumerable keys with Object.is', () => {
    expect(shallowEqual({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true)
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(shallowEqual({ a: { nested: 1 } }, { a: { nested: 1 } })).toBe(false)
    expect(shallowEqual(null, null)).toBe(true)
    expect(shallowEqual(null, {})).toBe(false)
  })

  it('arrayEqual compares element references', () => {
    const item = { key: 'a' }
    expect(arrayEqual([item], [item])).toBe(true)
    expect(arrayEqual([{ key: 'a' }], [{ key: 'a' }])).toBe(false)
    expect(arrayEqual([], [])).toBe(true)
  })
})

describe('actionEntryEqual', () => {
  const entry: ActionEntry = {
    id: 'reports:refresh',
    definitionId: 'reports',
    name: 'refresh',
    label: 'Refresh',
    placements: ['palette', 'agent'],
    effect: 'read',
    followUp: true,
    inputSchema: { type: 'object', properties: { scope: { type: 'string' } } },
    decision: allow(),
    shortcut: 'mod+r',
  }

  it('sees a changed shortcut, because the palette draws it', () => {
    expect(actionEntryEqual(entry, { ...entry })).toBe(true)
    expect(actionEntryEqual(entry, { ...entry, shortcut: 'g r' })).toBe(false)

    const { shortcut: _dropped, ...withoutShortcut } = entry
    expect(actionEntryEqual(entry, withoutShortcut)).toBe(false)
  })

  it('sees what the agent reads: the description, the effect and the schemas', () => {
    expect(actionEntryEqual(entry, { ...entry, description: 'Reloads the report.' })).toBe(false)
    expect(actionEntryEqual(entry, { ...entry, effect: 'write' })).toBe(false)
    expect(actionEntryEqual(entry, { ...entry, followUp: false })).toBe(false)
    expect(actionEntryEqual(entry, { ...entry, placements: ['palette'] })).toBe(false)
    expect(
      actionEntryEqual(entry, {
        ...entry,
        inputSchema: { type: 'object', properties: { scope: { type: 'number' } } },
      }),
    ).toBe(false)
  })

  it('compares schemas by value, so a schema converted again is the same entry', () => {
    expect(
      actionEntryEqual(entry, {
        ...entry,
        inputSchema: { type: 'object', properties: { scope: { type: 'string' } } },
      }),
    ).toBe(true)
  })
})

describe('jsonEqual', () => {
  it('compares JSON values deeply, arrays by position and objects by key', () => {
    expect(jsonEqual({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toBe(true)
    expect(jsonEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
    expect(jsonEqual({ a: 1 }, { a: 1, b: 1 })).toBe(false)
    expect(jsonEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false)
    expect(jsonEqual([], {})).toBe(false)
    expect(jsonEqual(undefined, {})).toBe(false)
    expect(jsonEqual(undefined, undefined)).toBe(true)
  })
})
