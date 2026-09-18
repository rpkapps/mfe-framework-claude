/**
 * The normal React storage API: a subscribed value and a stable setter.
 *
 * The binding lives for as long as the key, store and schema stay the same, so
 * an ordinary rerender neither re-reads the browser store nor re-subscribes.
 * Changing the key or store tears the old binding down and reads the new one.
 *
 * An invalid or unreadable stored value is not quietly replaced by the default.
 * The snapshot carries the error and reading it throws, so the failure reaches
 * the nearest error boundary instead of looking like missing data.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { ContractSchema, StorageArea, StorageKeyOptions } from '@company/mfe-core'
import type { BoundStorageKey, StorageUpdater } from '@company/mfe-host'

import { useMfeMount } from '../mount-context.tsx'

export type StoredStateSetter<T> = (next: T | StorageUpdater<T>) => void

export interface UseStoredStateOptions<T> extends StorageKeyOptions<T> {
  readonly defaultValue: T
  readonly storage?: StorageArea
}

export function useStoredState<T>(
  name: string,
  schema: ContractSchema<T>,
  options: UseStoredStateOptions<T>,
): readonly [T, StoredStateSetter<T>] {
  const mount = useMfeMount('useStoredState')
  const { storage } = mount.runtime

  const area: StorageArea = options.storage ?? 'local'

  // The schema and the option values are declared at module scope by contract,
  // so binding on the identifying fields is enough. Rebinding on a fresh
  // options object every render would defeat the caching entirely.
  const binding = useMemo(
    () =>
      storage.bind<T>(mount.definitionId, {
        name,
        area,
        schema,
        defaultValue: options.defaultValue,
        ...(options.retention === undefined ? {} : { retention: options.retention }),
        ...(options.version === undefined ? {} : { version: options.version }),
        ...(options.migrate === undefined ? {} : { migrate: options.migrate }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the remaining
    // options are part of the key's module-scope declaration; including them
    // would rebind on every render for values that cannot legally change.
    [storage, mount.definitionId, name, area, schema],
  )

  // Held in a ref so the setter identity survives a rebinding of the key.
  const current = useRef<BoundStorageKey<T>>(binding)
  current.current = binding

  useEffect(() => () => binding.release(), [binding])

  const value = useSyncExternalStore(binding.subscribe, binding.getSnapshot, binding.getSnapshot)

  const set = useCallback<StoredStateSetter<T>>(next => {
    current.current.set(next)
  }, [])

  if (value.status === 'error') throw value.error

  return [value.value, set]
}
