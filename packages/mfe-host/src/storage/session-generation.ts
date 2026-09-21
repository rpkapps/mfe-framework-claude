/**
 * Only the shell knows the first session generation of a page load, and the record is
 * host-scoped and browser-retained because it cannot be gated by what it establishes (§24).
 */

import { HOST_SCOPE, physicalStorageKey } from '@company/mfe-core'
import { z } from 'zod'

import type { MfeStorageStore } from './storage-store.ts'

export const SESSION_GENERATION_KEY = physicalStorageKey(HOST_SCOPE, 'session-generation')

/** Identity is stored beside the generation, not baked into it: it stays opaque. */
const recordSchema = z.object({ identity: z.string().min(1), generation: z.string().min(1) })

/** The counter fallback keeps non-secure contexts working; uniqueness per document is enough. */
let generationCounter = 0

/** A generation never used before; callers compare it for equality, never parse it. */
export function mintSessionGeneration(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  generationCounter += 1
  return `session-${Date.now()}-${generationCounter}`
}

export interface EstablishSessionGenerationOptions {
  /** A shell that coordinates several tabs supplies its own. */
  readonly mint?: () => string
}

/** Rotating a generation afterwards goes through `applySessionTransition`, never through this. */
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
    retention: 'browser',
  })

  try {
    const snapshot = key.getSnapshot()
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
      // Already on the store's diagnostics; the generation still fences every write.
    }
    return generation
  } finally {
    key.release()
  }
}
