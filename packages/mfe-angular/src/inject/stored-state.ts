/**
 * Stored state as signals, for every area. The key says where its value lives; the result has
 * the same shape for each: the value (the schema default while loading or after an error), an
 * awaitable `set`, and the key's status.
 */

import { assertInInjectionContext, computed, DestroyRef, inject, type Signal } from '@angular/core'
import {
  HOST_SCOPE,
  type AnyStoredKey,
  type ReadonlyStoredKey,
  type StorageError,
  type StoredKey,
  type StoredStatus,
  type StoredUpdate,
} from '@company/mfe-core'

import { signalFromStore } from '../signals.ts'
import { injectMfeRuntime, injectOptionalMfeMount } from './runtime.ts'

export interface InjectStoredStateOptions<T, R> {
  /** Narrows what `value` reads; it changes only when the selected part does. */
  readonly select?: (value: T) => R
}

export interface ReadonlyStoredState<R> {
  readonly value: Signal<R>
  readonly status: Signal<StoredStatus>
  readonly error: Signal<StorageError | undefined>
  /** After a failed load, loads again; after a failed save, sends it again. */
  retry(): Promise<void>
}

export interface StoredState<T, R = T> extends ReadonlyStoredState<R> {
  /** Always takes the whole value, even with `select`. Resolves once the value is stored. */
  set(next: StoredUpdate<T>): Promise<void>
  /** Removes the stored value, so the key reads its schema default again. */
  reset(): Promise<void>
}

export function injectStoredState<T, R = T>(
  key: StoredKey<T>,
  options?: InjectStoredStateOptions<T, R>,
): StoredState<T, R>
export function injectStoredState<T, R = T>(
  key: ReadonlyStoredKey<T>,
  options?: InjectStoredStateOptions<T, R>,
): ReadonlyStoredState<R>
export function injectStoredState<T, R = T>(
  key: AnyStoredKey<T>,
  options?: InjectStoredStateOptions<T, R>,
): StoredState<T, R> | ReadonlyStoredState<R> {
  assertInInjectionContext(injectStoredState)

  const mount = injectOptionalMfeMount()
  const { storage } = injectMfeRuntime('injectStoredState()')
  const binding = storage.bind(
    mount === null
      ? { owner: HOST_SCOPE }
      : { owner: mount.definitionId, instanceId: mount.instanceId, signal: mount.signal },
    key,
  )

  // Registered first, so its unsubscribe runs before the binding is released.
  const snapshot = signalFromStore(
    listener => binding.subscribe(listener),
    () => binding.getSnapshot(),
  )
  inject(DestroyRef).onDestroy(() => {
    binding.release()
  })

  const select = options?.select
  const value =
    select === undefined
      ? computed(() => snapshot().value as unknown as R)
      : computed(() => select(snapshot().value))
  const state: ReadonlyStoredState<R> = {
    value,
    status: computed(() => snapshot().status),
    error: computed(() => snapshot().error),
    retry: () => binding.retry(),
  }
  if (key.owner !== undefined) return state
  return {
    ...state,
    set: next => binding.set(next),
    reset: () => binding.reset(),
  }
}
