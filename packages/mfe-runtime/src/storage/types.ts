/** The browser stores are injected, so "unavailable" is a real branch, not an unreachable one. */

import type { z } from 'zod'

import type { Listener, StorageArea, StorageSnapshot, Unsubscribe } from '@company/mfe-core'

import type { DiagnosticsHub } from '../diagnostics.ts'

/** `clear()` is deliberately absent: the framework only ever removes its own `<id>:` prefix. */
export interface StorageAreaLike {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Re-invoked per operation, so a store that appears late or starts throwing is seen as it is. */
export type StorageAreaSource = StorageAreaLike | (() => StorageAreaLike)

export interface StorageEventTargetLike {
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
}

export interface StorageEventLike {
  readonly key: string | null
  readonly newValue: string | null
  readonly storageArea?: unknown
}

export interface MfeStorageStoreOptions {
  /** Omitted areas fall back to the matching browser global, read lazily. */
  readonly areas?: {
    readonly local?: StorageAreaSource
    readonly session?: StorageAreaSource
  }
  readonly diagnostics?: DiagnosticsHub
  /** Where cross-tab `storage` events are observed; `null` opts out entirely. */
  readonly eventTarget?: StorageEventTargetLike | null
}

/** `storage` defaults to `'local'` and `version` to `1`. */
export interface StorageKeyBinding<T> {
  readonly name: string
  readonly storage?: StorageArea
  readonly schema: z.ZodType<T>
  readonly version?: number
  /** Schema-validated at bind time, and never persisted. */
  readonly defaultValue?: T
  /** Synchronous, side-effect-free conversion from a known older version. */
  readonly migrate?: (value: unknown, fromVersion: number) => T
}

export type StorageUpdater<T> = (current: T) => T

/** Stable for the binding's lifetime, so a `useSyncExternalStore` consumer does not churn. */
export interface BoundStorageKey<T> {
  /** The physical key, `<definitionId>:<name>`, never scoped by mount token. */
  readonly key: string
  readonly definitionId: string
  readonly name: string
  readonly storage: StorageArea
  readonly version: number
  /** Pure cache read: never touches the browser store. */
  getSnapshot(): StorageSnapshot<T>
  subscribe(listener: Listener): Unsubscribe
  /** Throws the structured error when the current snapshot is an error snapshot. */
  read(): T
  set(next: T | StorageUpdater<T>): void
  remove(): void
  /** Drops this consumer's declaration; the key is torn down when the last one goes. */
  release(): void
}
