/**
 * An in-memory `StorageAreaLike` a host or a test may inject, never a fallback: a value
 * that quietly stops persisting is worse than a visible failure.
 */

import type { StorageAreaLike } from '../storage/types.ts'

export interface MemoryStorageArea extends StorageAreaLike {
  reset(): void
  snapshot(): Readonly<Record<string, string>>
  /**
   * Assertions about how often the store touches the browser live here rather than on the store
   * itself, so no counter ships in production.
   */
  readonly calls: { reads: number; writes: number; removes: number }
}

export function createMemoryStorageArea(
  initial: Readonly<Record<string, string>> = {},
): MemoryStorageArea {
  const entries = new Map<string, string>(Object.entries(initial))
  const calls = { reads: 0, writes: 0, removes: 0 }

  return {
    calls,
    get length(): number {
      return entries.size
    },
    key(index: number): string | null {
      if (!Number.isInteger(index) || index < 0) return null
      return [...entries.keys()][index] ?? null
    },
    getItem(key: string): string | null {
      calls.reads += 1
      return entries.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      calls.writes += 1
      entries.set(key, String(value))
    },
    removeItem(key: string): void {
      calls.removes += 1
      entries.delete(key)
    },
    reset(): void {
      entries.clear()
      calls.reads = 0
      calls.writes = 0
      calls.removes = 0
    },
    snapshot(): Readonly<Record<string, string>> {
      return Object.fromEntries(entries)
    },
  }
}
