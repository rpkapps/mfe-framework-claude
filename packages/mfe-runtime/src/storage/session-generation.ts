/**
 * Only the shell knows the first session generation of a page load, and the record is
 * host-scoped and browser-retained because it cannot be gated by what it establishes (§24).
 */

import { HOST_SCOPE, physicalStorageKey } from '@company/mfe-core'
import { z } from 'zod'

import type { MfeStorageStore } from './storage-store.ts'
import type { BoundStorageKey } from './types.ts'

export const SESSION_GENERATION_KEY = physicalStorageKey(HOST_SCOPE, 'session-generation')

/**
 * Identity and groups are stored beside the generation, not baked into it: it stays opaque. A
 * record written before the groups were recorded has none, and reads as another session.
 */
const recordSchema = z.object({
  identity: z.string().min(1),
  groups: z.array(z.string()).optional(),
  generation: z.string().min(1),
})

type SessionRecord = z.infer<typeof recordSchema>

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

/** A group set is a set: order and duplicates carry no meaning. */
function canonicalGroups(groups: readonly string[]): string[] {
  return [...new Set(groups)].sort()
}

function sameGroups(stored: readonly string[] | undefined, canonical: readonly string[]): boolean {
  return stored !== undefined && JSON.stringify(stored) === JSON.stringify(canonical)
}

function bindRecord(store: MfeStorageStore): BoundStorageKey<SessionRecord | null> {
  return store.bindHost({
    name: 'session-generation',
    storage: 'session',
    schema: recordSchema,
    retention: 'browser',
  })
}

export interface EstablishSessionGenerationOptions {
  /** A shell that coordinates several tabs supplies its own. */
  readonly mint?: () => string
}

/**
 * A reload reuses the generation only for the identity and group set it was minted for, since
 * a change of either retires every user-retained record. Rotating a generation afterwards goes
 * through `applySessionTransition`, never through this.
 */
export function establishSessionGeneration(
  store: MfeStorageStore,
  identity: string,
  groups: readonly string[],
  options: EstablishSessionGenerationOptions = {},
): string {
  const mint = options.mint ?? mintSessionGeneration
  const canonical = canonicalGroups(groups)
  const key = bindRecord(store)

  try {
    const snapshot = key.getSnapshot()
    const stored = snapshot.status === 'value' ? snapshot.value : null
    if (stored !== null && stored.identity === identity && sameGroups(stored.groups, canonical)) {
      store.establishSession(stored.generation)
      return stored.generation
    }

    const generation = mint()
    store.establishSession(generation)
    try {
      key.set({ identity, groups: canonical, generation })
    } catch {
      // Already on the store's diagnostics; the generation still fences every write.
    }
    return generation
  } finally {
    key.release()
  }
}

/**
 * For after `applySessionTransition` rotated the generation in the page: without it a reload
 * would establish the generation that transition retired.
 */
export function recordSessionGeneration(
  store: MfeStorageStore,
  identity: string,
  groups: readonly string[],
  generation: string,
): void {
  const key = bindRecord(store)
  try {
    key.set({ identity, groups: canonicalGroups(groups), generation })
  } catch {
    // Already on the store's diagnostics; the page still fences with the new generation.
  } finally {
    key.release()
  }
}
