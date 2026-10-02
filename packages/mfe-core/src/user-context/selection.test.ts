import { describe, expect, it, vi } from 'vitest'
import {
  createUserContextSelection,
  immutable,
  stableJson,
  type UserContextReader,
} from './index.ts'

function fixture<V extends object>(initial: V) {
  let value = immutable(structuredClone(initial))
  let invalid = false
  const keyed = new Map<keyof V & string, Set<() => void>>()
  const broad = new Set<() => void>()
  let onSubscribe: (() => void) | undefined
  const store: UserContextReader<V> = {
    getSnapshot: () => {
      if (invalid) throw new Error('scope disposed')
      return value
    },
    get: key => value[key],
    subscribe: (key, listener) => {
      const listeners = keyed.get(key) ?? new Set<() => void>()
      keyed.set(key, listeners)
      listeners.add(listener)
      const race = onSubscribe
      onSubscribe = undefined
      race?.()
      return () => {
        listeners.delete(listener)
        if (!listeners.size) keyed.delete(key)
      }
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
    keyed,
    broad,
    race: (callback: () => void) => {
      onSubscribe = callback
    },
    commit: (next: V) => {
      const previous = value
      value = immutable(structuredClone(next))
      for (const [key, listeners] of [...keyed])
        if (stableJson(previous[key]) !== stableJson(value[key]))
          for (const listener of [...listeners]) listener()
      for (const listener of [...broad]) listener()
    },
    invalidate: () => {
      invalid = true
      for (const listeners of [...keyed.values()]) for (const listener of [...listeners]) listener()
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
  it('tracks nested reads on frozen snapshots without rerunning on siblings', () => {
    const data = fixture(initial)
    const selector = vi.fn((value: typeof initial) => value.preferences.appearance.theme)
    const selected = createUserContextSelection(data.store, selector)
    const listener = vi.fn()
    expect(selected.getSnapshot()).toBe('light')
    const stop = selected.subscribe(listener)
    expect([...data.keyed.keys()]).toEqual(['preferences'])
    expect(data.broad.size).toBe(0)
    data.commit({ ...initial, count: 2 })
    data.commit({
      ...initial,
      preferences: { ...initial.preferences, appearance: { theme: 'light', font: 14 } },
    })
    expect(selector).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
    data.commit({
      ...initial,
      preferences: { ...initial.preferences, appearance: { theme: 'dark', font: 14 } },
    })
    expect(selected.getSnapshot()).toBe('dark')
    expect(selector).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
    expect(data.keyed.size).toBe(0)
  })

  it('reuses selected object branches and unwraps returned proxies', () => {
    const data = fixture(initial)
    const selected = createUserContextSelection(data.store, value => ({
      appearance: value.preferences.appearance,
    }))
    const before = selected.getSnapshot()
    expect(before.appearance).toBe(data.store.getSnapshot().preferences.appearance)
    data.commit({ ...initial, preferences: { ...initial.preferences, language: 'fr' } })
    expect(selected.getSnapshot()).toBe(before)
    data.commit({
      ...initial,
      preferences: { ...initial.preferences, appearance: { theme: 'dark', font: 12 } },
    })
    expect(selected.getSnapshot()).toEqual({ appearance: { theme: 'dark', font: 12 } })
    expect(selected.getSnapshot()).not.toBe(before)
  })

  it('changes subscriptions when a conditional dependency changes', () => {
    const data = fixture(initial)
    const selector = vi.fn((value: typeof initial) =>
      value.alternate ? value.count : value.preferences.appearance.theme,
    )
    const selected = createUserContextSelection(data.store, selector)
    const listener = vi.fn()
    const stop = selected.subscribe(listener)
    expect([...data.keyed.keys()]).toEqual(['alternate', 'preferences'])
    data.commit({ ...initial, alternate: true })
    expect(selected.getSnapshot()).toBe(1)
    expect([...data.keyed.keys()]).toEqual(['alternate', 'count'])
    data.commit({
      ...initial,
      alternate: true,
      preferences: { ...initial.preferences, language: 'fr' },
    })
    expect(selector).toHaveBeenCalledTimes(2)
    stop()
  })

  it('tracks missing optional paths and replacement of their parent', () => {
    const data = fixture<{ settings?: { theme: string; font: number } }>({})
    const selector = vi.fn(
      (value: { settings?: { theme: string; font: number } }) => value.settings?.theme ?? 'default',
    )
    const selected = createUserContextSelection(data.store, selector)
    const stop = selected.subscribe(vi.fn())
    expect(selected.getSnapshot()).toBe('default')
    data.commit({ settings: { theme: 'dark', font: 12 } })
    expect(selected.getSnapshot()).toBe('dark')
    data.commit({ settings: { theme: 'dark', font: 14 } })
    expect(selector).toHaveBeenCalledTimes(2)
    data.commit({})
    expect(selected.getSnapshot()).toBe('default')
    stop()
  })

  it('tracks array indices, iteration and length without unrelated element fields', () => {
    const data = fixture(initial)
    const selector = vi.fn((value: typeof initial) => value.items.map(item => item.id))
    const selected = createUserContextSelection(data.store, selector)
    const listener = vi.fn()
    const stop = selected.subscribe(listener)
    const before = selected.getSnapshot()
    data.commit({ ...initial, items: [{ id: 1, label: 'renamed' }, initial.items[1]!] })
    expect(selected.getSnapshot()).toBe(before)
    expect(selector).toHaveBeenCalledTimes(1)
    data.commit({ ...initial, items: [...initial.items, { id: 3, label: 'third' }] })
    expect(selected.getSnapshot()).toEqual([1, 2, 3])
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })

  it('notifies only when derived values change', () => {
    const data = fixture(initial)
    const selected = createUserContextSelection(data.store, value => ({
      even: value.count % 2 === 0,
    }))
    const listener = vi.fn()
    const stop = selected.subscribe(listener)
    const before = selected.getSnapshot()
    data.commit({ ...initial, count: 3 })
    expect(selected.getSnapshot()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    data.commit({ ...initial, count: 4 })
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })

  it('observes root enumeration and notices new keys', () => {
    const data = fixture<Record<string, number>>({ a: 1 })
    const selected = createUserContextSelection(data.store, value => Object.keys(value))
    const stop = selected.subscribe(vi.fn())
    expect(data.broad.size).toBe(1)
    data.commit({ a: 1, b: 2 })
    expect(selected.getSnapshot()).toEqual(['a', 'b'])
    stop()
  })

  it('invalidates constant selectors and validates retained reads after cleanup', () => {
    const data = fixture(initial)
    const selector = vi.fn(() => 'constant')
    const selected = createUserContextSelection(data.store, selector)
    const listener = vi.fn()
    const stop = selected.subscribe(listener)
    data.commit({ ...initial, count: 2 })
    expect(selector).toHaveBeenCalledTimes(1)
    data.invalidate()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(() => selected.getSnapshot()).toThrow('scope disposed')
    stop()
    expect(data.broad.size).toBe(0)
    expect(() => selected.getSnapshot()).toThrow('scope disposed')
  })

  it('notices commits while registering subscriptions', () => {
    const data = fixture(initial)
    const selected = createUserContextSelection(data.store, value => value.count)
    expect(selected.getSnapshot()).toBe(1)
    data.race(() => data.commit({ ...initial, count: 2 }))
    const listener = vi.fn()
    const stop = selected.subscribe(listener)
    expect(selected.getSnapshot()).toBe(2)
    expect(listener).toHaveBeenCalled()
    stop()
  })

  it('recovers from selector errors after relevant values change', () => {
    const data = fixture(initial)
    const selected = createUserContextSelection(data.store, value => {
      if (value.count === 2) throw new Error('invalid count')
      return value.count
    })
    const listener = vi.fn()
    const stop = selected.subscribe(listener)
    data.commit({ ...initial, count: 2 })
    expect(() => selected.getSnapshot()).toThrow('invalid count')
    data.commit({ ...initial, count: 3 })
    expect(selected.getSnapshot()).toBe(3)
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
  })

  it('shares one subscription across listeners and cleans up only after the last one', () => {
    const data = fixture(initial)
    const selected = createUserContextSelection(data.store, value => value.count)
    const stopA = selected.subscribe(vi.fn())
    const stopB = selected.subscribe(vi.fn())
    expect(data.keyed.get('count')?.size).toBe(1)
    stopA()
    expect(data.keyed.get('count')?.size).toBe(1)
    stopB()
    expect(data.keyed.size).toBe(0)
  })
  it('keeps derived and updated selections deeply immutable', () => {
    const data = fixture(initial)
    const selected = createUserContextSelection(data.store, value => ({
      preferences: value.preferences,
      count: value.count,
    }))
    const before = selected.getSnapshot()
    expect(Object.isFrozen(before)).toBe(true)
    expect(Object.isFrozen(before.preferences.appearance)).toBe(true)
    data.commit({
      ...initial,
      preferences: { ...initial.preferences, appearance: { theme: 'dark', font: 14 } },
    })
    const after = selected.getSnapshot()
    expect(Object.isFrozen(after)).toBe(true)
    expect(Object.isFrozen(after.preferences.appearance)).toBe(true)
    expect(() => {
      after.preferences.appearance.theme = 'corrupt'
    }).toThrow(TypeError)
    expect(selected.getSnapshot().preferences.appearance.theme).toBe('dark')
  })

  it('tracks descriptor values and nested reads through descriptors', () => {
    const data = fixture(initial)
    const selected = createUserContextSelection(data.store, value => {
      const descriptor = Object.getOwnPropertyDescriptor(value.preferences.appearance, 'theme')
      return descriptor?.value as string | undefined
    })
    const listener = vi.fn()
    const stop = selected.subscribe(listener)
    data.commit({
      ...initial,
      preferences: { ...initial.preferences, appearance: { theme: 'dark', font: 12 } },
    })
    expect(selected.getSnapshot()).toBe('dark')
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })

  it('uses the owner observer for inherited methods and absent root properties', () => {
    const data = fixture(initial)
    const subscribe = data.store.subscribe.bind(data.store)
    data.store.subscribe = (key, listener) => {
      if (!Object.hasOwn(initial, key)) throw new Error('undeclared field')
      return subscribe(key, listener)
    }
    const selected = createUserContextSelection(data.store, value =>
      Object.prototype.hasOwnProperty.call(value, 'missing') ? 0 : value.count,
    )
    const stop = selected.subscribe(vi.fn())
    expect(data.broad.size).toBe(1)
    data.commit({ ...initial, count: 2 })
    expect(selected.getSnapshot()).toBe(2)
    stop()
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
  ])('rejects unsupported %s outputs without leaking tracked proxies', (_name, selector) => {
    const data = fixture(initial)
    const selected = createUserContextSelection<typeof initial, unknown>(data.store, selector)
    expect(() => selected.getSnapshot()).toThrow(
      'User-context selectors must return primitives, plain objects or arrays',
    )
  })
})
