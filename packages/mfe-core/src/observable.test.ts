import { describe, expect, it, vi } from 'vitest'

import {
  arrayEqual,
  KeyedListeners,
  ListenerSet,
  shallowEqual,
  SnapshotSource,
} from './observable.ts'

describe('SnapshotSource', () => {
  it('keeps the snapshot reference stable until the value actually changes', () => {
    const initial = { theme: 'dark' }
    const source = new SnapshotSource(initial)

    expect(source.getSnapshot()).toBe(initial)
    source.set(initial)
    expect(source.getSnapshot()).toBe(initial)
  })

  it('does not notify subscribers for a no-op update', () => {
    const source = new SnapshotSource('comfortable')
    const listener = vi.fn()
    source.subscribe(listener)

    expect(source.set('comfortable')).toBe(false)
    expect(listener).not.toHaveBeenCalled()

    expect(source.set('compact')).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('accepts a custom equality so aggregate selections do not imply deep comparison', () => {
    const source = new SnapshotSource({ a: 1 }, { areEqual: shallowEqual })
    const listener = vi.fn()
    source.subscribe(listener)

    source.set({ a: 1 })
    expect(listener).not.toHaveBeenCalled()

    source.set({ a: 2 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('exposes stable getSnapshot and subscribe references for useSyncExternalStore', () => {
    const source = new SnapshotSource(0)
    expect(source.getSnapshot).toBe(source.getSnapshot)
    expect(source.subscribe).toBe(source.subscribe)
  })

  it('stops notifying after unsubscribe, and unsubscribing twice is harmless', () => {
    const source = new SnapshotSource(0)
    const listener = vi.fn()
    const unsubscribe = source.subscribe(listener)

    source.set(1)
    unsubscribe()
    unsubscribe()
    source.set(2)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(source.listenerCount).toBe(0)
  })
})

describe('ListenerSet', () => {
  it('reports a throwing listener without skipping the remaining listeners', () => {
    const onListenerError = vi.fn()
    const listeners = new ListenerSet(onListenerError)
    const second = vi.fn()

    listeners.add(() => {
      throw new Error('listener failed')
    })
    listeners.add(second)
    listeners.notify()

    expect(second).toHaveBeenCalledTimes(1)
    expect(onListenerError).toHaveBeenCalledTimes(1)
  })

  it('tolerates a listener that unsubscribes during notification', () => {
    const listeners = new ListenerSet()
    const second = vi.fn()
    const removeSecond = listeners.add(second)
    listeners.add(() => removeSecond())

    expect(() => listeners.notify()).not.toThrow()
  })
})

describe('KeyedListeners', () => {
  it('notifies only the subscribers for the written key', () => {
    const keyed = new KeyedListeners()
    const density = vi.fn()
    const filters = vi.fn()

    keyed.subscribe('operations:table-density', density)
    keyed.subscribe('operations:filters', filters)
    keyed.notify('operations:table-density')

    expect(density).toHaveBeenCalledTimes(1)
    expect(filters).not.toHaveBeenCalled()
  })

  it('drops a key entirely once its last subscriber leaves', () => {
    const keyed = new KeyedListeners()
    const unsubscribe = keyed.subscribe('a', () => {})

    expect(keyed.activeKeys()).toEqual(['a'])
    unsubscribe()
    expect(keyed.activeKeys()).toEqual([])
    expect(keyed.listenerCount('a')).toBe(0)
  })

  it('supports several subscribers sharing one key', () => {
    const keyed = new KeyedListeners()
    const first = vi.fn()
    const second = vi.fn()

    keyed.subscribe('shared', first)
    keyed.subscribe('shared', second)
    keyed.notify('shared')

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })
})

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
