import { describe, expect, it } from 'vitest'

import { allow, arrayEqual, actionEntryEqual, shallowEqual, type ActionEntry } from './records.ts'

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
    placements: ['palette'],
    decision: allow(),
    shortcut: 'mod+r',
  }

  it('sees a changed shortcut, because the palette draws it', () => {
    expect(actionEntryEqual(entry, { ...entry })).toBe(true)
    expect(actionEntryEqual(entry, { ...entry, shortcut: 'g r' })).toBe(false)

    const { shortcut: _dropped, ...withoutShortcut } = entry
    expect(actionEntryEqual(entry, withoutShortcut)).toBe(false)
  })
})
