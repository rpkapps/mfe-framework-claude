/**
 * The framework's only subscription primitives (§12.4: small purpose-specific
 * plain TypeScript structures, no general state-management dependency).
 *
 * Two invariants hold everywhere these are used, because §1.4 makes them part
 * of the public contract rather than an optimization:
 *
 * 1. A snapshot is immutable and cached. An unchanged snapshot keeps its
 *    reference, so `useSyncExternalStore` consumers do not re-render.
 * 2. A no-op update notifies nobody. Equality is checked before publishing.
 */

export type Unsubscribe = () => void
export type Listener = () => void

/** The shape React's `useSyncExternalStore` needs, and non-React hosts can poll. */
export interface Subscribable<T> {
  getSnapshot(): T
  subscribe(listener: Listener): Unsubscribe
}

/**
 * Notifies listeners, tolerating subscribe/unsubscribe during notification by
 * iterating a copy. A listener that throws must not prevent the remaining
 * listeners from running; the failure is reported through `onListenerError` so
 * it cannot be swallowed (§17.6: no silent catches).
 */
export class ListenerSet {
  readonly #listeners = new Set<Listener>()

  constructor(private readonly onListenerError?: (error: unknown) => void) {}

  get size(): number {
    return this.#listeners.size
  }

  add(listener: Listener): Unsubscribe {
    this.#listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.#listeners.delete(listener)
    }
  }

  notify(): void {
    if (this.#listeners.size === 0) return
    for (const listener of [...this.#listeners]) {
      try {
        listener()
      } catch (error) {
        this.onListenerError?.(error)
      }
    }
  }

  clear(): void {
    this.#listeners.clear()
  }
}

/**
 * A single cached immutable snapshot with change-gated notification.
 *
 * `set` replaces the snapshot only when `areEqual` reports a difference, so
 * publishing an equivalent value is genuinely free for subscribers.
 */
export class SnapshotSource<T> implements Subscribable<T> {
  #snapshot: T
  readonly #listeners: ListenerSet
  readonly #areEqual: (a: T, b: T) => boolean

  constructor(
    initial: T,
    options: {
      readonly areEqual?: (a: T, b: T) => boolean
      readonly onListenerError?: (error: unknown) => void
    } = {},
  ) {
    this.#snapshot = initial
    this.#areEqual = options.areEqual ?? Object.is
    this.#listeners = new ListenerSet(options.onListenerError)
  }

  /** Stable across the source's lifetime; safe to pass straight to React. */
  readonly getSnapshot = (): T => this.#snapshot

  /** Stable across the source's lifetime; safe to pass straight to React. */
  readonly subscribe = (listener: Listener): Unsubscribe => this.#listeners.add(listener)

  get listenerCount(): number {
    return this.#listeners.size
  }

  /** Publishes `next` and returns whether subscribers were notified. */
  set(next: T): boolean {
    if (this.#areEqual(this.#snapshot, next)) return false
    this.#snapshot = next
    this.#listeners.notify()
    return true
  }

  /** Applies a pure update to the current snapshot. */
  update(produce: (current: T) => T): boolean {
    return this.set(produce(this.#snapshot))
  }

  /**
   * Replaces the snapshot without notifying. Used only where a caller
   * deliberately batches several changes and notifies once; see `notify`.
   */
  setSilently(next: T): void {
    this.#snapshot = next
  }

  notify(): void {
    this.#listeners.notify()
  }

  dispose(): void {
    this.#listeners.clear()
  }
}

/**
 * Subscriptions partitioned by an exact string key.
 *
 * Storage (§5.13) and shell state (§5.4.4) both need this: writing one storage
 * key, or changing only the theme, must notify that key's subscribers and no
 * one else. A single shared listener list would broadcast every change to every
 * consumer, which §1.4 forbids.
 */
export class KeyedListeners {
  readonly #byKey = new Map<string, ListenerSet>()

  constructor(private readonly onListenerError?: (error: unknown) => void) {}

  subscribe(key: string, listener: Listener): Unsubscribe {
    let listeners = this.#byKey.get(key)
    if (!listeners) {
      listeners = new ListenerSet(this.onListenerError)
      this.#byKey.set(key, listeners)
    }
    const remove = listeners.add(listener)
    return () => {
      remove()
      const current = this.#byKey.get(key)
      if (current && current.size === 0) this.#byKey.delete(key)
    }
  }

  notify(key: string): void {
    this.#byKey.get(key)?.notify()
  }

  /** The keys that currently have at least one subscriber. */
  activeKeys(): readonly string[] {
    return [...this.#byKey.keys()]
  }

  listenerCount(key: string): number {
    return this.#byKey.get(key)?.size ?? 0
  }

  clear(): void {
    for (const listeners of this.#byKey.values()) listeners.clear()
    this.#byKey.clear()
  }
}

/** Shallow equality by own enumerable keys, comparing values with `Object.is`. */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false

  const aKeys = Object.keys(a as Record<string, unknown>)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) return false

  for (const key of aKeys) {
    if (!Object.hasOwn(b as object, key)) return false
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false
    }
  }
  return true
}

/** Element-wise equality for readonly arrays, comparing with `Object.is`. */
export function arrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (!Object.is(a[index], b[index])) return false
  }
  return true
}
