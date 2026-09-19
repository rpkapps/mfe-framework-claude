/**
 * The normal React storage API: a subscribed value and a stable setter.
 *
 * An invalid or unreadable stored value is not quietly replaced by the default.
 * The snapshot carries the error and reading it throws, so the failure reaches
 * the nearest error boundary instead of looking like missing data.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { StorageArea, StorageKeyOptions } from '@company/mfe-core'
import type { StorageUpdater } from '@company/mfe-host'
import type { z } from 'zod'

import { useMfeMount } from '../mount-context.tsx'

export type StoredStateSetter<T> = (next: T | StorageUpdater<T>) => void

export interface UseStoredStateOptions<T> extends StorageKeyOptions<T> {
  readonly defaultValue: T
  readonly storage?: StorageArea
}

export function useStoredState<T>(
  name: string,
  schema: z.ZodType<T>,
  options: UseStoredStateOptions<T>,
): readonly [T, StoredStateSetter<T>] {
  const mount = useMfeMount('useStoredState')
  const { storage } = mount.runtime
  const area: StorageArea = options.storage ?? 'local'

  // A key's declaration is module-scope by contract, so the first render's
  // values are this component's declaration. Capturing them is what keeps a
  // freshly allocated default or an inline migrate from rebinding every render.
  const [declaration] = useState(() => ({
    defaultValue: options.defaultValue,
    ...(options.retention === undefined ? {} : { retention: options.retention }),
    ...(options.version === undefined ? {} : { version: options.version }),
    ...(options.migrate === undefined ? {} : { migrate: options.migrate }),
  }))

  const binding = useMemo(
    () => storage.bind<T>(mount.definitionId, { name, storage: area, schema, ...declaration }),
    [storage, mount.definitionId, name, area, schema, declaration],
  )

  useEffect(() => () => binding.release(), [binding])

  const subscribe = useCallback((listener: () => void) => binding.subscribe(listener), [binding])
  const getSnapshot = useCallback(() => binding.getSnapshot(), [binding])
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Updated after commit rather than during render, so the setter identity can
  // survive a rebinding of the key without reading a ref mid-render.
  const current = useRef(binding)
  useEffect(() => {
    current.current = binding
  }, [binding])

  const set = useCallback<StoredStateSetter<T>>(next => {
    current.current.set(next)
  }, [])

  if (value.status === 'error') throw value.error

  return [value.value, set]
}
