import { describe, expect, it, vi } from 'vitest'
import { createUserContextSelection, immutable, type UserContextReader } from './index.ts'

function fixture<V extends object>(initial: V) {
  let value = immutable(structuredClone(initial))
  let invalid = false
  const broad = new Set<() => void>()
  const store: UserContextReader<V> = {
    getSnapshot: () => {
      if (invalid) throw new Error('scope disposed')
      return value
    },
    get: key => value[key],
    subscribe: () => {
      throw new Error('Selections observe the owner record')
    },
    observe: listener => {
      broad.add(listener)
      return () => {
        broad.delete(listener)
      }
    },
  }
  return {
    store,
    broad,
    commit: (next: V) => {
      value = immutable(structuredClone(next))
      for (const listener of [...broad]) listener()
    },
    invalidate: () => {
      invalid = true
      for (const listener of [...broad]) listener()
    },
  }
}
const initial = {
  preferences: { appearance: { theme: 'light', font: 12 }, language: 'en' },
  count: 1,
  alternate: false,
  items: [
    { id: 1, label: 'first' },
    { id: 2, label: 'second' },
  ],
}

describe('createUserContextSelection', () => {
  it('keeps the selected value for sibling commits and observes the owner only once subscribed', () => {
    const data = fixture(initial)
    const selection = createUserContextSelection(data.store)
    const selector = (value: typeof initial) => value.preferences.appearance.theme
    expect(selection.read(selector)).toBe('light')
    expect(data.broad.size).toBe(0)
    const listener = vi.fn()
    const stop = selection.subscribe(listener)
    expect(data.broad.size).toBe(1)
    data.commit({ ...initial, count: 2 })
    expect(selection.read(selector)).toBe('light')
    data.commit({
      ...initial,
      preferences: { ...initial.preferences, appearance: { theme: 'dark', font: 14 } },
    })
    expect(selection.read(selector)).toBe('dark')
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    expect(data.broad.size).toBe(0)
  })

  it('reruns only when the record or the selector changes', () => {
    const data = fixture(initial)
    const selection = createUserContextSelection(data.store)
    const selector = vi.fn((value: typeof initial) => value.count)
    selection.read(selector)
    selection.read(selector)
    expect(selector).toHaveBeenCalledTimes(1)
    data.commit({ ...initial, count: 2 })
    expect(selection.read(selector)).toBe(2)
    expect(selector).toHaveBeenCalledTimes(2)
  })

  it('returns snapshot branches as they are and keeps them across sibling commits', () => {
    const data = fixture(initial)
    const selection = createUserContextSelection(data.store)
    const selector = (value: typeof initial) => ({ appearance: value.preferences.appearance })
    const before = selection.read(selector)
    expect(before.appearance).toBe(data.store.getSnapshot().preferences.appearance)
    data.commit({ ...initial, preferences: { ...initial.preferences, language: 'fr' } })
    expect(selection.read(selector)).toBe(before)
    data.commit({
      ...initial,
      preferences: { ...initial.preferences, appearance: { theme: 'dark', font: 12 } },
    })
    expect(selection.read(selector)).toEqual({ appearance: { theme: 'dark', font: 12 } })
    expect(selection.read(selector)).not.toBe(before)
  })

  it('follows optional paths when their parent appears, changes and disappears', () => {
    const data = fixture<{ settings?: { theme: string; font: number } }>({})
    const selection = createUserContextSelection(data.store)
    const selector = (value: { settings?: { theme: string; font: number } }) =>
      value.settings?.theme ?? 'default'
    expect(selection.read(selector)).toBe('default')
    data.commit({ settings: { theme: 'dark', font: 12 } })
    expect(selection.read(selector)).toBe('dark')
    data.commit({})
    expect(selection.read(selector)).toBe('default')
  })

  it('keeps derived arrays and objects whose contents did not change', () => {
    const data = fixture(initial)
    const selection = createUserContextSelection(data.store)
    const ids = (value: typeof initial) => value.items.map(item => item.id)
    const even = (value: typeof initial) => ({ even: value.count % 2 === 0 })
    const beforeIds = selection.read(ids)
    data.commit({ ...initial, items: [{ id: 1, label: 'renamed' }, initial.items[1]!] })
    expect(selection.read(ids)).toBe(beforeIds)
    data.commit({ ...initial, items: [...initial.items, { id: 3, label: 'third' }] })
    expect(selection.read(ids)).toEqual([1, 2, 3])
    const beforeEven = selection.read(even)
    data.commit({ ...initial, count: 3 })
    expect(selection.read(even)).toBe(beforeEven)
    data.commit({ ...initial, count: 4 })
    expect(selection.read(even)).toEqual({ even: true })
  })

  it('keeps an unchanged derived value across re-created selector closures', () => {
    const data = fixture(initial)
    const selection = createUserContextSelection(data.store)
    const before = selection.read(value => ({ count: value.count }))
    expect(selection.read(value => ({ count: value.count }))).toBe(before)
    const negated = selection.read(value => ({ count: -value.count }))
    expect(negated).toEqual({ count: -1 })
    expect(Object.isFrozen(negated)).toBe(true)
  })

  it('selects root enumeration and notices new keys', () => {
    const data = fixture<Record<string, number>>({ a: 1 })
    const selection = createUserContextSelection(data.store)
    const keys = (value: Record<string, number>) => Object.keys(value)
    expect(selection.read(keys)).toEqual(['a'])
    data.commit({ a: 1, b: 2 })
    expect(selection.read(keys)).toEqual(['a', 'b'])
  })

  it('notifies on invalidation and validates retained reads after cleanup', () => {
    const data = fixture(initial)
    const selection = createUserContextSelection(data.store)
    const selector = () => 'constant'
    const listener = vi.fn()
    selection.read(selector)
    const stop = selection.subscribe(listener)
    data.invalidate()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(() => selection.read(selector)).toThrow('scope disposed')
    stop()
    expect(data.broad.size).toBe(0)
    expect(() => selection.read(selector)).toThrow('scope disposed')
  })

  it('notices commits between a read and subscribing', () => {
    const data = fixture(initial)
    const selection = createUserContextSelection(data.store)
    expect(selection.read(value => value.count)).toBe(1)
    data.commit({ ...initial, count: 2 })
    const listener = vi.fn()
    const stop = selection.subscribe(listener)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(selection.read(value => value.count)).toBe(2)
    stop()
  })

  it('recovers from selector errors after the record changes', () => {
    const data = fixture(initial)
    const selection = createUserContextSelection(data.store)
    const selector = (value: typeof initial) => {
      if (value.count === 2) throw new Error('invalid count')
      return value.count
    }
    expect(selection.read(selector)).toBe(1)
    data.commit({ ...initial, count: 2 })
    expect(() => selection.read(selector)).toThrow('invalid count')
    expect(() => selection.read(selector)).toThrow('invalid count')
    data.commit({ ...initial, count: 3 })
    expect(selection.read(selector)).toBe(3)
  })

  it('keeps derived and updated selections deeply immutable', () => {
    const data = fixture(initial)
    const selection = createUserContextSelection(data.store)
    const selector = (value: typeof initial) => ({
      preferences: value.preferences,
      count: value.count,
    })
    const before = selection.read(selector)
    expect(Object.isFrozen(before)).toBe(true)
    expect(Object.isFrozen(before.preferences.appearance)).toBe(true)
    data.commit({
      ...initial,
      preferences: { ...initial.preferences, appearance: { theme: 'dark', font: 14 } },
    })
    const after = selection.read(selector)
    expect(Object.isFrozen(after)).toBe(true)
    expect(Object.isFrozen(after.preferences.appearance)).toBe(true)
    expect(() => {
      after.preferences.appearance.theme = 'corrupt'
    }).toThrow(TypeError)
    expect(selection.read(selector).preferences.appearance.theme).toBe('dark')
    const unfrozen = selection.read(() => Object.freeze({ nested: { value: 1 } }))
    expect(Object.isFrozen(unfrozen.nested)).toBe(true)
  })

  it.each([
    ['Map', (value: typeof initial) => new Map([['preferences', value.preferences]])],
    [
      'nested Map',
      (value: typeof initial) => ({ map: new Map([['preferences', value.preferences]]) }),
    ],
    ['Set', (value: typeof initial) => new Set([value.preferences])],
    ['Date', () => new Date(0)],
    ['function', (value: typeof initial) => () => value.count],
    [
      'cycle',
      () => {
        const value: { self?: unknown } = {}
        value.self = value
        return value
      },
    ],
  ])('rejects unsupported %s outputs', (_name, selector) => {
    const data = fixture(initial)
    const selection = createUserContextSelection(data.store)
    expect(() => selection.read<unknown>(selector)).toThrow(
      'User-context selectors must return primitives, plain objects or arrays',
    )
  })
})
