/**
 * An in-memory `StorageAreaLike`.
 *
 * This is a store a host or a test may *inject*. It is never a fallback: the
 * framework does not silently switch to memory when a browser store is
 * unavailable, because a value that quietly stops persisting is worse than a
 * visible failure.
 */

import type { StorageAreaLike } from './types.ts'

export interface MemoryStorageArea extends StorageAreaLike {
  /** Wipes the whole fake store. Test-only convenience; not part of `StorageAreaLike`. */
  reset(): void
  snapshot(): Readonly<Record<string, string>>
}

export function createMemoryStorageArea(
  initial: Readonly<Record<string, string>> = {},
): MemoryStorageArea {
  const entries = new Map<string, string>(Object.entries(initial))

  return {
    get length(): number {
      return entries.size
    },
    key(index: number): string | null {
      if (!Number.isInteger(index) || index < 0) return null
      return [...entries.keys()][index] ?? null
    },
    getItem(key: string): string | null {
      return entries.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      entries.set(key, String(value))
    },
    removeItem(key: string): void {
      entries.delete(key)
    },
    reset(): void {
      entries.clear()
    },
    snapshot(): Readonly<Record<string, string>> {
      return Object.fromEntries(entries)
    },
  }
}
