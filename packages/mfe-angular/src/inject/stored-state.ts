/**
 * Stored state as a signal, resolved by position: the definition's record inside a mount, the
 * reserved host scope outside one. An unreadable stored value throws rather than falling back to
 * the default, so the failure reaches the `ErrorHandler` instead of looking like missing data.
 */

import { assertInInjectionContext, computed, DestroyRef, inject, type Signal } from '@angular/core'
import { withoutUndefined, type StorageArea, type StorageKeyOptions } from '@company/mfe-core'
import type { StorageUpdater } from '@company/mfe-runtime'
import type { z } from 'zod'

import { signalFromStore } from '../signals.ts'
import { injectMfeRuntime, injectOptionalMfeMount } from './runtime.ts'

export interface StoredStateOptions<T> extends StorageKeyOptions<T> {
  readonly defaultValue: T
  readonly storage?: StorageArea
}

export interface StoredState<T> {
  /** Throws the stored value's error when it could not be read or migrated. */
  readonly value: Signal<T>
  set(next: T | StorageUpdater<T>): void
  remove(): void
}

export function injectStoredState<T>(
  name: string,
  schema: z.ZodType<T>,
  options: StoredStateOptions<T>,
): StoredState<T> {
  assertInInjectionContext(injectStoredState)

  const mount = injectOptionalMfeMount()
  const { storage } = injectMfeRuntime('injectStoredState()')

  const declaration = {
    name,
    schema,
    storage: options.storage ?? 'local',
    defaultValue: options.defaultValue,
    ...withoutUndefined({
      retention: options.retention,
      version: options.version,
      migrate: options.migrate,
    }),
  }

  const binding =
    mount === null
      ? storage.bindHost<T>(declaration)
      : storage.bind<T>(mount.definitionId, declaration)

  // Registered first, so its unsubscribe runs before the binding is released.
  const snapshot = signalFromStore(
    listener => binding.subscribe(listener),
    () => binding.getSnapshot(),
  )
  inject(DestroyRef).onDestroy(() => {
    binding.release()
  })

  // Thrown at creation too, so a component whose stored record is unreadable fails to construct
  // rather than rendering a default the user never chose.
  const initial = snapshot()
  if (initial.status === 'error') throw initial.error

  const value = computed(() => {
    const current = snapshot()
    if (current.status === 'error') throw current.error
    return current.value
  })

  return {
    value,
    set: next => {
      binding.set(next)
    },
    remove: () => {
      binding.remove()
    },
  }
}
