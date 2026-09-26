/**
 * The normal React storage API; an unreadable stored value throws rather than falling back to
 * the default, so the failure reaches an error boundary instead of looking like missing data.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  withoutUndefined,
  type StorageArea,
  type StorageKeyOptions,
  type StorageRetention,
} from '@company/mfe-core'
import type { BoundStorageKey, StorageUpdater } from '@company/mfe-runtime'
import type { z } from 'zod'

import { useOptionalMfeMount } from '../mount-context.tsx'
import { useMfeRuntime } from '../runtime-context.tsx'

export type StoredStateSetter<T> = (next: T | StorageUpdater<T>) => void

export interface UseStoredStateOptions<T> extends StorageKeyOptions<T> {
  readonly defaultValue: T
  readonly storage?: StorageArea
}

interface CapturedDeclaration<T> {
  readonly defaultValue: T
  readonly retention?: StorageRetention
  readonly version?: number
  readonly migrate?: (value: unknown, fromVersion: number) => T
}

/** Capturing the first render's values keeps a fresh default or inline migrate from rebinding. */
function useDeclaration<T>(options: UseStoredStateOptions<T>): CapturedDeclaration<T> {
  const [declaration] = useState(() => ({
    defaultValue: options.defaultValue,
    ...withoutUndefined({
      retention: options.retention,
      version: options.version,
      migrate: options.migrate,
    }),
  }))
  return declaration
}

/**
 * Stored state resolved by position rather than by a sibling hook: the definition's record
 * inside a mount, the reserved `@host` scope outside one (§24).
 */
export function useStoredState<T>(
  name: string,
  schema: z.ZodType<T>,
  options: UseStoredStateOptions<T>,
): readonly [T, StoredStateSetter<T>] {
  // Being outside a mount is a legal position here, so a miss picks a scope rather than failing.
  const mount = useOptionalMfeMount()
  const { storage } = useMfeRuntime('useStoredState()')
  const area: StorageArea = options.storage ?? 'local'
  const declaration = useDeclaration(options)

  const definitionId = mount?.definitionId

  const open = useCallback(
    () =>
      definitionId === undefined
        ? storage.bindHost<T>({ name, storage: area, schema, ...declaration })
        : storage.bind<T>(definitionId, { name, storage: area, schema, ...declaration }),
    [storage, definitionId, name, area, schema, declaration],
  )

  return useBoundValue(open)
}

interface HeldBinding<T> {
  readonly open: () => BoundStorageKey<T>
  readonly binding: BoundStorageKey<T>
}

/**
 * Everything the hook does once it can open a binding — the same in either scope. A binding is
 * held only from subscribe to unsubscribe, which React pairs even when it replays effects under
 * StrictMode; one taken during render would stay open whenever React discarded that render.
 */
function useBoundValue<T>(open: () => BoundStorageKey<T>): readonly [T, StoredStateSetter<T>] {
  const held = useRef<HeldBinding<T> | null>(null)

  // Read through a binding released at once, so the key stays open only while it is subscribed.
  const initial = useMemo(() => {
    const binding = open()
    const snapshot = binding.getSnapshot()
    binding.release()
    return snapshot
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
  const getSnapshot = useCallback(() => {
    const current = held.current
    return current !== null && current.open === open ? current.binding.getSnapshot() : initial
  }, [open, initial])
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Updated after commit, so the setter identity survives a rebinding without a mid-render read.
  const latestOpen = useRef(open)
  useEffect(() => {
    latestOpen.current = open
  }, [open])

  const set = useCallback<StoredStateSetter<T>>(next => {
    const binding = held.current?.binding
    if (binding !== undefined) {
      binding.set(next)
      return
    }
    // A child's mount effect runs before this component subscribes, and may already write.
    const transient = latestOpen.current()
    try {
      transient.set(next)
    } finally {
      transient.release()
    }
  }, [])

  if (value.status === 'error') throw value.error

  return [value.value, set]
}
