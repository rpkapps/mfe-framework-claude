/** An unchanged snapshot keeps its reference and a no-op notifies nobody, both by contract. */

import type { Listener, Subscribable, Unsubscribe } from '@company/mfe-core'

/** Iterates a copy, so a listener may subscribe or unsubscribe during notification. */
export class ListenerSet {
  readonly #listeners = new Set<Listener>()
  readonly #onError: ((error: unknown) => void) | undefined

  // A parameter property would read the same, but Node cannot strip one from the TypeScript
  // source the generate CLI runs directly.
  constructor(onListenerError?: (error: unknown) => void) {
    this.#onError = onListenerError
  }

  get size(): number {
    return this.#listeners.size
  }

  add(listener: Listener): Unsubscribe {
    this.#listeners.add(listener)
    // `active` keeps a stale unsubscribe from removing a listener that was added again after it.
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

/** Partitioned by exact key, so one storage write cannot notify every other key's subscribers. */
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
      // Evicting the empty set bounds the map, and re-reading rather than closing over it keeps
      // a stale unsubscribe from evicting a later subscription's entry.
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
