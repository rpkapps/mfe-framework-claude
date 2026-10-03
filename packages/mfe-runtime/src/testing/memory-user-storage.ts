/** A `user` storage backend held in memory, for tests and local examples. */

import type {
  StoredRow,
  StoredValue,
  UserStorageAdapter,
  UserStorageHandle,
  UserStorageState,
} from '@company/mfe-core'

export interface MemoryUserStorage extends UserStorageAdapter {
  /** What the backend holds now, as `load()` would return it. */
  snapshot(): UserStorageState
  /** Writes as another tab or device would, and pushes the result to every `sync` handle. */
  write(owner: string, key: string, value: StoredValue | null): void
  /** Every save the framework sent, in order. */
  readonly saves: readonly { readonly owner: string; readonly key: string; readonly value: StoredValue | null }[]
}

export function createMemoryUserStorage(initial: UserStorageState = {}): MemoryUserStorage {
  const rows = new Map<string, Map<string, StoredRow>>()
  for (const [owner, keys] of Object.entries(initial))
    rows.set(owner, new Map(Object.entries(keys)))
  const handles = new Set<UserStorageHandle>()
  const saves: { owner: string; key: string; value: StoredValue | null }[] = []

  const snapshot = (): UserStorageState =>
    Object.fromEntries(
      [...rows].map(([owner, keys]) => [owner, Object.fromEntries(keys)] as const),
    )
  const store = (owner: string, key: string, value: StoredValue | null): StoredRow | null => {
    let keys = rows.get(owner)
    if (keys === undefined) {
      keys = new Map()
      rows.set(owner, keys)
    }
    const revision = (keys.get(key)?.revision ?? 0) + 1
    if (value === null) {
      keys.delete(key)
      return null
    }
    const row: StoredRow = { v: value.v, d: structuredClone(value.d), revision }
    keys.set(key, row)
    return row
  }

  return {
    saves,
    snapshot,
    load: () => Promise.resolve(snapshot()),
    save: (owner, key, value) => {
      saves.push({ owner, key, value })
      return Promise.resolve(store(owner, key, value))
    },
    sync: (handle, signal) => {
      handles.add(handle)
      signal.addEventListener('abort', () => handles.delete(handle), { once: true })
    },
    write: (owner, key, value) => {
      store(owner, key, value)
      const state = snapshot()
      for (const handle of handles) handle.replace(state)
    },
  }
}
