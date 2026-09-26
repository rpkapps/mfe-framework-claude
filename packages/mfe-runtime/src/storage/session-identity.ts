/**
 * Whom the tab's session was last recorded for, so a boot can tell that somebody else signed in to
 * the tab since, and drop what the previous user left for the page: their developer overrides
 * (§23). The record is host-scoped and lives in `sessionStorage`, so it dies with the tab (§24).
 */

import { z } from 'zod'

import type { MfeStorageStore } from './storage-store.ts'

const recordSchema = z.object({ identity: z.string().min(1) })

export interface RecordedSessionIdentity {
  /**
   * Whoever the tab's record was written for, when that was somebody else; `null` when it was
   * this identity, or the tab had no readable record.
   */
  readonly previousIdentity: string | null
}

/** Reads the record, then writes this identity into it. */
export function recordSessionIdentity(
  store: MfeStorageStore,
  identity: string,
): RecordedSessionIdentity {
  const key = store.bindHost({ name: 'session-identity', storage: 'session', schema: recordSchema })
  try {
    const snapshot = key.getSnapshot()
    const stored = snapshot.status === 'value' ? (snapshot.value?.identity ?? null) : null
    if (stored !== identity) {
      try {
        key.set({ identity })
      } catch {
        // Already on the store's diagnostics; the next boot then compares against nothing.
      }
    }
    return { previousIdentity: stored !== null && stored !== identity ? stored : null }
  } finally {
    key.release()
  }
}
