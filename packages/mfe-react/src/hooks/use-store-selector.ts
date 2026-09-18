/**
 * The selector layer over `useSyncExternalStore`.
 *
 * React's own store hook has no selector, and a freshly derived result on every
 * read looks like a change and re-renders forever. This caches per snapshot and
 * compares with `Object.is`, so narrowing to a primitive or an existing
 * reference is free — a selector that allocates cannot be de-duplicated.
 */

import { useRef, useSyncExternalStore } from 'react'

export type Selector<S, T> = (snapshot: S) => T

interface SelectionCache<S, T> {
  snapshot: S
  selector: Selector<S, T>
  value: T
}

export function useStoreSelector<S, T>(
  subscribe: (listener: () => void) => () => void,
  getSnapshot: () => S,
  selector: Selector<S, T>,
): T {
  const cache = useRef<SelectionCache<S, T> | null>(null)

  const getSelection = (): T => {
    const snapshot = getSnapshot()
    const cached = cache.current

    // Same snapshot and same selector: nothing can have changed.
    if (cached && Object.is(cached.snapshot, snapshot) && cached.selector === selector) {
      return cached.value
    }

    const value = selector(snapshot)

    // An inline selector is a new function on every render. Comparing the result
    // keeps that from looking like a state change.
    if (cached && Object.is(cached.value, value)) {
      cache.current = { snapshot, selector, value: cached.value }
      return cached.value
    }

    cache.current = { snapshot, selector, value }
    return value
  }

  return useSyncExternalStore(subscribe, getSelection, getSelection)
}

/** The identity selector, allocated once so the cache can compare it by reference. */
export function identitySelector<S>(snapshot: S): S {
  return snapshot
}
