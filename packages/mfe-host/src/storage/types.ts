/** The browser stores are injected, so "unavailable" is a real branch, not an unreachable one. */

import type { z } from 'zod'

import type {
  DiagnosticsHub,
  Listener,
  StorageArea,
  StorageRetention,
  StorageSnapshot,
  Unsubscribe,
} from '@company/mfe-core'

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
  /** Opaque: user-retained values cannot be read or written until it is established. */
  readonly sessionGeneration?: string
  /** The current semantic group set, so a reordered but identical set is a no-op. */
  readonly groups?: readonly string[]
  /** Where cross-tab `storage` events are observed; `null` opts out entirely. */
  readonly eventTarget?: StorageEventTargetLike | null
}

/** `storage` defaults to `'local'`, `retention` to `'browser'` and `version` to `1`. */
export interface StorageKeyBinding<T> {
  readonly name: string
  readonly storage?: StorageArea
  readonly schema: z.ZodType<T>
  readonly retention?: StorageRetention
  readonly version?: number
  /** Schema-validated at bind time, and never persisted. */
  readonly defaultValue?: T
  /** Synchronous, side-effect-free conversion from a known older version. */
  readonly migrate?: (value: unknown, fromVersion: number) => T
}

export type StorageUpdater<T> = (current: T) => T

export interface StorageWriteOptions {
  /** A write from a retired generation is rejected, which fences off a late async handler. */
  readonly generation?: string
}

/** Stable for the binding's lifetime, so a `useSyncExternalStore` consumer does not churn. */
export interface BoundStorageKey<T> {
  /** The physical key, `<definitionId>:<name>`, never scoped by mount token. */
  readonly key: string
  readonly definitionId: string
  readonly name: string
  readonly storage: StorageArea
  readonly retention: StorageRetention
  readonly version: number
  /** Pure cache read: never touches the browser store. */
  getSnapshot(): StorageSnapshot<T>
  subscribe(listener: Listener): Unsubscribe
  /** Throws the structured error when the current snapshot is an error snapshot. */
  read(): T
  set(next: T | StorageUpdater<T>, options?: StorageWriteOptions): void
  remove(options?: StorageWriteOptions): void
  /** Drops this consumer's declaration; the key is torn down when the last one goes. */
  release(): void
}

/** Widened from core's `ShellTransition` with `groups`, to tell a change from a reorder. */
export type StorageSessionTransition =
  | { readonly kind: 'theme' }
  | { readonly kind: 'token-refresh' }
  | {
      readonly kind: 'identity'
      readonly reason: 'login' | 'logout' | 'account' | 'tenant'
      readonly groups?: readonly string[]
    }
  | { readonly kind: 'groups'; readonly groups?: readonly string[] }

export type SessionTransitionOutcome =
  'invalidated' | 'unchanged-group-set' | 'not-session-affecting'

export interface SessionTransitionResult {
  readonly outcome: SessionTransitionOutcome
  readonly generation: string | null
  /** User-retained records physically removed, across both stores. */
  readonly removedRecords: number
  /** Active keys whose subscribers were notified of a reset value. */
  readonly notifiedKeys: number
}
