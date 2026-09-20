/**
 * The first session generation of a page load.
 *
 * Every `retention: 'user'` record carries an opaque generation and reads as
 * absent under any other, which is what stops one person's draft reappearing
 * for the next person on the same browser profile. The runtime mints a new one
 * whenever identity changes, but it cannot invent the *first*: only the shell
 * knows which session the page opened in, and without one every session-
 * retained write is refused.
 *
 * The record is host-scoped, browser-retained and held in `sessionStorage`, so
 * it needs no generation to be read back and has exactly the lifetime of the
 * data it fences. The framework still owns no session: `identity` is an opaque
 * marker the shell chooses and compares, never a token and never a group list.
 */

import { HOST_SCOPE, physicalStorageKey } from '@company/mfe-core'
import { z } from 'zod'

import type { MfeStorageStore } from './storage-store.ts'

/** The host-scoped key the record is written under. `@host:session-generation`. */
export const SESSION_GENERATION_KEY = physicalStorageKey(HOST_SCOPE, 'session-generation')

/** Identity is stored beside the generation, not baked into it: it stays opaque. */
const recordSchema = z.object({ identity: z.string().min(1), generation: z.string().min(1) })

/** The counter fallback keeps non-secure contexts working; uniqueness per document is enough. */
let generationCounter = 0

/** A generation never used before. Callers compare it for equality, never parse it. */
export function mintSessionGeneration(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  generationCounter += 1
  return `session-${Date.now()}-${generationCounter}`
}

export interface EstablishSessionGenerationOptions {
  /**
   * Mints the generation for a session this tab has not seen. A shell that
   * coordinates several tabs supplies its own; the default is a random
   * identifier.
   */
  readonly mint?: () => string
}

/**
 * Resolves this tab's generation — the one already in force for the same
 * identity, otherwise a fresh one — establishes it on `store` and returns it.
 * Call it once, at boot, before anything mounts: rotating a generation goes
 * through `applySessionTransition`, which retires the previous records first.
 *
 * A store that cannot persist is not a failure here. The generation is still
 * established, so every write this page makes is fenced; it just does not
 * survive the reload, as the data it fences would not either.
 */
export function establishSessionGeneration(
  store: MfeStorageStore,
  identity: string,
  options: EstablishSessionGenerationOptions = {},
): string {
  const mint = options.mint ?? mintSessionGeneration
  const key = store.bindHost({
    name: 'session-generation',
    storage: 'session',
    schema: recordSchema,
    // Never `'user'`: this is the record the user-retained ones are checked
    // against, so it cannot be gated by the thing it establishes.
    retention: 'browser',
  })

  try {
    const snapshot = key.getSnapshot()
    // An unreadable or absent record is a session this tab has not opened yet.
    const stored = snapshot.status === 'value' ? snapshot.value : null
    if (stored !== null && stored.identity === identity) {
      store.establishSession(stored.generation)
      return stored.generation
    }

    const generation = mint()
    store.establishSession(generation)
    try {
      key.set({ identity, generation })
    } catch {
      // Already on the store's diagnostics. A generation that cannot be
      // remembered still fences every write made under it.
    }
    return generation
  } finally {
    key.release()
  }
}
