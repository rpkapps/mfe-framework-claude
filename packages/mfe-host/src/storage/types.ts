/**
 * Public types of the host storage boundary.
 *
 * The browser stores are injected rather than reached for, because the module
 * must behave identically when `localStorage` is a fake in a test, is absent in
 * a non-browser context, or throws a `SecurityError` on property access in a
 * locked-down browsing context. Reaching for the global directly would make
 * "unavailable" an unreachable branch instead of a first-class failure.
 */

import type {
  ContractSchema,
  DiagnosticsHub,
  Listener,
  StorageArea,
  StorageRetention,
  StorageSnapshot,
  Unsubscribe,
} from '@company/mfe-core'

/**
 * The subset of the DOM `Storage` interface the framework uses. `clear()` is
 * deliberately absent: the framework only ever removes its own `<id>:` prefix,
 * never the whole store.
 */
export interface StorageAreaLike {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * An area, or a factory for one. A factory is re-invoked per operation, so a
 * store that only becomes available later — or that starts throwing — is
 * observed as it actually is rather than as it was at construction time.
 */
export type StorageAreaSource = StorageAreaLike | (() => StorageAreaLike)

/** The minimum of `EventTarget` needed to observe cross-tab `storage` events. */
export interface StorageEventTargetLike {
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
}

/** The parts of a native `StorageEvent` the store reads. */
export interface StorageEventLike {
  readonly key: string | null
  readonly newValue: string | null
  readonly storageArea?: unknown
}

export interface MfeStorageStoreOptions {
  /** Injected areas. Omitted areas fall back to the matching browser global, read lazily. */
  readonly areas?: {
    readonly local?: StorageAreaSource
    readonly session?: StorageAreaSource
  }
  readonly diagnostics?: DiagnosticsHub
  /**
   * The opaque session/access generation for the current session.
   * Stable across reloads of one continuous session; never a token and never a
   * group list. Session-retained values cannot be read or written until it is
   * established.
   */
  readonly sessionGeneration?: string
  /** The current semantic group set, so a reordered but identical set is a no-op. */
  readonly groups?: readonly string[]
  /**
   * Where cross-tab `storage` events are observed. Defaults to `globalThis`;
   * pass `null` to opt out entirely (a non-browser host, or a test that feeds
   * events through `handleStorageEvent`).
   */
  readonly eventTarget?: StorageEventTargetLike | null
}

/**
 * What a consumer declares for one key. `area` defaults to `'local'`,
 * `retention` to `'session'` and `version` to `1`.
 */
export interface StorageKeyBinding<T> {
  readonly name: string
  readonly area?: StorageArea
  readonly schema: ContractSchema<T>
  readonly retention?: StorageRetention
  readonly version?: number
  /** Schema-validated at bind time. Applies only to a missing key and is never persisted. */
  readonly defaultValue?: T
  /** Synchronous, side-effect-free conversion from a known older version. */
  readonly migrate?: (value: unknown, fromVersion: number) => T
}

export type StorageUpdater<T> = (current: T) => T

export interface StorageWriteOptions {
  /**
   * The session generation the caller believes it is writing in. A write from a
   * retired generation is rejected instead of committed, which is how
   * an in-flight async handler that resolves after a logout is fenced off.
   */
  readonly generation?: string
}

/**
 * One consumer's handle on one `<id>:<key>` in one store. `getSnapshot`,
 * `subscribe` and `set` are stable for the lifetime of the key binding, so a
 * `useSyncExternalStore` consumer neither resubscribes nor re-renders while the
 * value and the binding are unchanged.
 */
export interface BoundStorageKey<T> {
  /** The physical key, `<definitionId>:<name>`. Never scoped by mount token. */
  readonly key: string
  readonly definitionId: string
  readonly name: string
  readonly area: StorageArea
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

/**
 * Why shell state changed, from the storage boundary's point of view. Every
 * `ShellTransition` from `@company/mfe-core` is assignable to it; the extra
 * `groups` field lets the store tell a semantic group change from a reorder.
 */
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
  readonly invalidated: boolean
  /** The generation in force after the transition. */
  readonly generation: string | null
  /** Session-retained records physically removed, across both stores. */
  readonly removedRecords: number
  /** Active keys whose subscribers were notified of a reset value. */
  readonly notifiedKeys: number
}
