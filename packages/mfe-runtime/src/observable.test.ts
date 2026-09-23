import { describe, expect, it, vi } from 'vitest'

import { shallowEqual } from '@company/mfe-core'

import { KeyedListeners, ListenerSet, SnapshotSource } from './observable.ts'

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
    const listener = vi.fn()
    const unsubscribe = keyed.subscribe('a', listener)

    expect(keyed.listenerCount('a')).toBe(1)
    unsubscribe()

    expect(keyed.listenerCount('a')).toBe(0)
    keyed.notify('a')
    expect(listener).not.toHaveBeenCalled()
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
