/**
 * The one React storage hook, for every area. A key declared with `storedKey` says where its
 * value lives; the hook returns the same shape for each: the value (the schema default while
 * loading or after an error), an awaitable `set`, and the key's status.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  HOST_SCOPE,
  type AnyStoredKey,
  type ReadonlyStoredKey,
  type StorageError,
  type StoredKey,
  type StoredSnapshot,
  type StoredStatus,
  type StoredUpdate,
} from '@company/mfe-core'
import type { StorageCaller, StoredBinding } from '@company/mfe-runtime'

import { useOptionalMfeMount } from '../mount-context.tsx'
import { useMfeRuntime } from '../runtime-context.tsx'

export interface UseStoredStateOptions<T, R> {
  /**
   * Narrows what the component reads; it re-renders only when the selected part changes. Inline
   * functions are fine.
   */
  readonly select?: (value: T) => R
}

export interface ReadonlyStoredState<R> {
  readonly value: R
  readonly status: StoredStatus
  readonly error: StorageError | undefined
  /** After a failed load, loads again; after a failed save, sends it again. */
  retry(): Promise<void>
}

export interface StoredState<T, R = T> extends ReadonlyStoredState<R> {
  /** Always takes the whole value, even with `select`. Resolves once the value is stored. */
  set(next: StoredUpdate<T>): Promise<void>
  /** Removes the stored value, so the key reads its schema default again. */
  reset(): Promise<void>
}

type ReadonlyStoredSnapshot<R> = Pick<ReadonlyStoredState<R>, 'value' | 'status' | 'error'>

interface Selected<R> {
  readonly snapshot: StoredSnapshot<unknown>
  readonly result: ReadonlyStoredSnapshot<R>
}

export function useStoredState<T, R = T>(
  key: StoredKey<T>,
  options?: UseStoredStateOptions<T, R>,
): StoredState<T, R>
export function useStoredState<T, R = T>(
  key: ReadonlyStoredKey<T>,
  options?: UseStoredStateOptions<T, R>,
): ReadonlyStoredState<R>
export function useStoredState<T, R = T>(
  key: AnyStoredKey<T>,
  options?: UseStoredStateOptions<T, R>,
): StoredState<T, R> | ReadonlyStoredState<R> {
  // Outside a mount is a legal position: the host page's own values live in the host scope.
  const mount = useOptionalMfeMount()
  const { storage } = useMfeRuntime('useStoredState()')
  const owner = mount?.definitionId ?? HOST_SCOPE
  const instanceId = mount?.instanceId
  const signal = mount?.signal

  const caller = useMemo<StorageCaller>(
    () => ({ owner, instanceId, signal }),
    [owner, instanceId, signal],
  )
  const open = useCallback(() => storage.bind(caller, key), [storage, caller, key])
  const { read, subscribe, withBinding } = useBinding(open)

  const select = options?.select
  const latestSelect = useRef(select)
  useEffect(() => {
    latestSelect.current = select
  })
  const selected = useRef<Selected<R> | null>(null)

  const getSnapshot = useCallback((): ReadonlyStoredSnapshot<R> => {
    const snapshot = read()
    const selector = latestSelect.current
    if (selector === undefined) return snapshot as unknown as ReadonlyStoredSnapshot<R>
    const previous = selected.current
    if (previous !== null && previous.snapshot === snapshot) return previous.result
    const value = selector(snapshot.value as T)
    // An unchanged selection keeps its identity, so React bails out of the render.
    const result =
      previous !== null &&
      Object.is(previous.result.value, value) &&
      previous.result.status === snapshot.status &&
      previous.result.error === snapshot.error
        ? previous.result
        : { value, status: snapshot.status, error: snapshot.error }
    selected.current = { snapshot, result }
    return result
  }, [read])

  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const set = useCallback(
    (next: StoredUpdate<T>) => withBinding(binding => binding.set(next)),
    [withBinding],
  )
  const reset = useCallback(() => withBinding(binding => binding.reset()), [withBinding])
  const retry = useCallback(() => withBinding(binding => binding.retry()), [withBinding])

  return useMemo(
    () =>
      key.owner === undefined
        ? { value: current.value, status: current.status, error: current.error, set, reset, retry }
        : { value: current.value, status: current.status, error: current.error, retry },
    [key.owner, current.value, current.status, current.error, set, reset, retry],
  )
}

interface HeldBinding<T> {
  readonly open: () => StoredBinding<T>
  readonly binding: StoredBinding<T>
}

/**
 * A binding is held only from subscribe to unsubscribe, which React pairs even when it replays
 * effects under StrictMode; one taken during render would stay open whenever React discarded
 * that render.
 */
function useBinding<T>(open: () => StoredBinding<T>): {
  readonly read: () => StoredSnapshot<T>
  readonly subscribe: (listener: () => void) => () => void
  readonly withBinding: <R>(use: (binding: StoredBinding<T>) => R) => R
} {
  const held = useRef<HeldBinding<T> | null>(null)

  // Read through a binding released at once, so the key stays open only while it is subscribed.
  const initial = useMemo(() => {
    const binding = open()
    try {
      return binding.getSnapshot()
    } finally {
      binding.release()
    }
  }, [open])

  const subscribe = useCallback(
    (listener: () => void) => {
      const binding = open()
      const entry = { open, binding }
      held.current = entry
      const unsubscribe = binding.subscribe(listener)
      return () => {
        unsubscribe()
        binding.release()
        if (held.current === entry) held.current = null
      }
    },
    [open],
  )

  // Until the subscription for this key is in place, the held binding, if any, is another key's.
  const read = useCallback(() => {
    const current = held.current
    return current !== null && current.open === open ? current.binding.getSnapshot() : initial
  }, [open, initial])

  const latestOpen = useRef(open)
  useEffect(() => {
    latestOpen.current = open
  }, [open])

  // A child's mount effect runs before this component subscribes, and may already write.
  const withBinding = useCallback(<R,>(use: (binding: StoredBinding<T>) => R): R => {
    const current = held.current
    if (current !== null) return use(current.binding)
    const transient = latestOpen.current()
    try {
      return use(transient)
    } finally {
      transient.release()
    }
  }, [])

  return { read, subscribe, withBinding }
}
