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
  readonly #onError: ((error: unknown) => void) | undefined

  // A constructor parameter property would read the same, but Node cannot strip
  // one from a TypeScript source it is asked to run directly, and the generate
  // CLI reaches these modules that way — with no bundler and no build step.
  constructor(onListenerError?: (error: unknown) => void) {
    this.#onError = onListenerError
  }

  get size(): number {
    return this.#listeners.size
  }

  add(listener: Listener): Unsubscribe {
    this.#listeners.add(listener)
    // `active` is what keeps a stale unsubscribe from removing a listener that
    // was added again after it: a Set holds one entry per function reference.
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
        this.#onError?.(error)
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
  readonly #onError: ((error: unknown) => void) | undefined

  constructor(onListenerError?: (error: unknown) => void) {
    this.#onError = onListenerError
  }

  subscribe(key: string, listener: Listener): Unsubscribe {
    let listeners = this.#byKey.get(key)
    if (!listeners) {
      listeners = new ListenerSet(this.#onError)
      this.#byKey.set(key, listeners)
    }
    const remove = listeners.add(listener)
    return () => {
      remove()
      // Evicting the empty set keeps a long-lived map from growing one entry
      // per key that was ever subscribed. Re-read rather than close over the
      // set, so a stale unsubscribe cannot evict a later subscription's entry.
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
    this.#byKey.clear()
  }
}

/** Shallow equality by own enumerable keys, comparing values with `Object.is`. */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false

  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  const right = b as Record<string, unknown>
  for (const key of aKeys) {
    if (!Object.hasOwn(right, key)) return false
    if (!Object.is((a as Record<string, unknown>)[key], right[key])) return false
  }
  return true
}

/** Element-wise equality for readonly arrays, comparing with `Object.is`. */
export function arrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((entry, index) => Object.is(entry, b[index]))
}
