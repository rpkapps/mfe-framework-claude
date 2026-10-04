import { useMemo, useSyncExternalStore } from 'react'

import type { StorageError } from '@company/mfe-core'
import type { UserLoadPhase, UserRowState, UserStorageStore } from '@company/mfe-runtime'

/** What a row is doing now, as the inspector labels it. */
export type UserStorageEntryStatus = 'loading' | 'ready' | 'saving' | 'error'

export interface UserStorageEntry {
  readonly owner: string
  readonly key: string
  readonly state: UserRowState
}

export interface UserStorageSnapshot {
  readonly phase: UserLoadPhase
  /** The failed load; each row's own failure is on its state. */
  readonly loadError: StorageError | undefined
  readonly entries: readonly UserStorageEntry[]
}

const unavailable: UserStorageSnapshot = Object.freeze({
  phase: 'ready',
  loadError: undefined,
  entries: [],
})
const getUnavailable = (): UserStorageSnapshot => unavailable
const subscribeUnavailable = (): (() => void) => () => {}

export function entryStatus(state: UserRowState): UserStorageEntryStatus {
  if (state.error !== undefined) return 'error'
  if (state.phase === 'loading') return 'loading'
  if (state.pending !== undefined) return 'saving'
  return 'ready'
}

function sameEntries(a: readonly UserStorageEntry[], b: readonly UserStorageEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.owner === b[index]?.owner &&
        entry.key === b[index]?.key &&
        entry.state === b[index]?.state,
    )
  )
}

/**
 * `entries()` builds a new array on every call, so the snapshot is cached and replaced only when
 * the phase, the load error or a row's state changes; `read()` already keeps each row's state stable.
 */
function inspect(store: UserStorageStore): {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => UserStorageSnapshot
} {
  let cached: UserStorageSnapshot | undefined
  return {
    subscribe: listener => store.subscribeAll(listener),
    getSnapshot: () => {
      const phase = store.phase
      const loadError = store.loadError
      // A removed row stays behind as an empty slot; it has nothing left to show.
      const entries = store
        .entries()
        .filter(
          ({ state }) =>
            state.row !== undefined || state.pending !== undefined || state.error !== undefined,
        )
        .sort((a, b) => a.owner.localeCompare(b.owner) || a.key.localeCompare(b.key))
      if (
        cached !== undefined &&
        cached.phase === phase &&
        cached.loadError === loadError &&
        sameEntries(cached.entries, entries)
      )
        return cached
      cached = Object.freeze({ phase, loadError, entries })
      return cached
    },
  }
}

/** The hook remains unconditional when the shell has no user storage adapter. */
export function useUserStorageInspection(store: UserStorageStore | undefined): UserStorageSnapshot {
  const source = useMemo(
    () =>
      store === undefined
        ? { subscribe: subscribeUnavailable, getSnapshot: getUnavailable }
        : inspect(store),
    [store],
  )
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
}
