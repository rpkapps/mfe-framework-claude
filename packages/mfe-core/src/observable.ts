/**
 * The framework's only subscription primitives. Two invariants are public
 * contract, not optimization: an unchanged snapshot keeps its reference, so
 * `useSyncExternalStore` consumers do not re-render, and a no-op notifies nobody.
 */

export type Unsubscribe = () => void
export type Listener = () => void

/** The shape React's `useSyncExternalStore` needs, and non-React hosts can poll. */
export interface Subscribable<T> {
  getSnapshot(): T
  subscribe(listener: Listener): Unsubscribe
}

/**
 * Notifies listeners, iterating a copy so a listener may subscribe or
 * unsubscribe during notification. A throwing listener must not stop the rest,
 * and its failure goes to `onListenerError` so it cannot be swallowed.
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

/** A single cached immutable snapshot, published only when `areEqual` sees a change. */
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

  /** Publishes `next` and returns whether subscribers were notified. */
  set(next: T): boolean {
    if (this.#areEqual(this.#snapshot, next)) return false
    this.#snapshot = next
    this.#listeners.notify()
    return true
  }

  dispose(): void {
    this.#listeners.clear()
  }
}

/**
 * Subscriptions partitioned by an exact string key: writing one storage key, or
 * changing only the theme, must notify that key's subscribers and no one else.
 * A single shared listener list would broadcast every change to every consumer,
 * which the reactivity contract forbids.
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
      // Evicting the empty set keeps a long-lived map from growing one entry
      // per key that was ever subscribed.
      const current = this.#byKey.get(key)
      if (current && current.size === 0) this.#byKey.delete(key)
    }
  }

  notify(key: string): void {
    this.#byKey.get(key)?.notify()
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

  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false

  for (const key of aKeys) {
    if (!Object.hasOwn(b, key)) return false
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
