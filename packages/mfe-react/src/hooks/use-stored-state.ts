/**
 * The normal React storage API: a subscribed value and a stable setter.
 *
 * An invalid or unreadable stored value is not quietly replaced by the default.
 * The snapshot carries the error and reading it throws, so the failure reaches
 * the nearest error boundary instead of looking like missing data.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { StorageArea, StorageKeyOptions, StorageRetention } from '@company/mfe-core'
import type { BoundStorageKey, StorageUpdater } from '@company/mfe-host'
import type { z } from 'zod'

import { useOptionalMfeMount } from '../mount-context.tsx'
import { useMfeRuntime } from '../runtime-context.tsx'

export type StoredStateSetter<T> = (next: T | StorageUpdater<T>) => void

export interface UseStoredStateOptions<T> extends StorageKeyOptions<T> {
  readonly defaultValue: T
  readonly storage?: StorageArea
}

/** What the first render captured, in the shape the store's binding declares. */
interface CapturedDeclaration<T> {
  readonly defaultValue: T
  readonly retention?: StorageRetention
  readonly version?: number
  readonly migrate?: (value: unknown, fromVersion: number) => T
}

/**
 * A key's declaration is module-scope by contract, so the first render's values
 * are this component's declaration. Capturing them keeps a freshly allocated
 * default or an inline migrate from rebinding every render.
 */
function useDeclaration<T>(options: UseStoredStateOptions<T>): CapturedDeclaration<T> {
  const [declaration] = useState(() => ({
    defaultValue: options.defaultValue,
    ...(options.retention === undefined ? {} : { retention: options.retention }),
    ...(options.version === undefined ? {} : { version: options.version }),
    ...(options.migrate === undefined ? {} : { migrate: options.migrate }),
  }))
  return declaration
}

/**
 * Stored state, scoped by where the component renders.
 *
 * Inside a mount the record is the definition's, under its id. Outside one it
 * is the host's, in the reserved `@host` scope. Both get the same envelope,
 * schema validation, versioning and cross-tab events; only the owner differs.
 *
 * The scope follows the position in the tree, not the call site, so the same
 * component moved between the two reads a different record. That is the
 * accepted cost, and the one `useCommand` and `useBreadcrumbs` already carry: a
 * separate hook per scope is a decision every caller can restate wrongly.
 *
 * `retention` decides who reads a record back, in either scope: `'browser'` for
 * impersonal state that outlives a sign-out, the default `'user'` otherwise.
 */
export function useStoredState<T>(
  name: string,
  schema: z.ZodType<T>,
  options: UseStoredStateOptions<T>,
): readonly [T, StoredStateSetter<T>] {
  // Never `useMfeMount`: being outside a mount is a legal position for this
  // hook, so the miss picks a scope rather than failing.
  const mount = useOptionalMfeMount()
  const { storage } = useMfeRuntime('useStoredState()')
  const area: StorageArea = options.storage ?? 'local'
  const declaration = useDeclaration(options)

  const definitionId = mount?.definitionId

  const binding = useMemo(
    () =>
      definitionId === undefined
        ? storage.bindHost<T>({ name, storage: area, schema, ...declaration })
        : storage.bind<T>(definitionId, { name, storage: area, schema, ...declaration }),
    [storage, definitionId, name, area, schema, declaration],
  )

  return useBoundValue(binding)
}

/** Everything the hook does once it holds a binding — the same in either scope. */
function useBoundValue<T>(binding: BoundStorageKey<T>): readonly [T, StoredStateSetter<T>] {
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
