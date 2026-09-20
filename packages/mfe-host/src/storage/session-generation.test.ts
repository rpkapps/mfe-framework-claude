/**
 * The first generation of a page load.
 *
 * What matters is what the shell was hand-rolling: that a reload of the same
 * tab keeps the generation, that a different identity never reuses one, and
 * that a store which cannot persist still ends up with a generation in force
 * rather than refusing every session-retained write.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { DiagnosticsHub } from '@company/mfe-core'

import { createMemoryStorageArea, type MemoryStorageArea } from '../testing/memory-storage-area.ts'
import { establishSessionGeneration, SESSION_GENERATION_KEY } from './session-generation.ts'
import { MfeStorageStore } from './storage-store.ts'
import type { StorageAreaLike } from './types.ts'

const draftSchema = z.object({ text: z.string() })

let stores: MfeStorageStore[] = []

beforeEach(() => {
  stores = []
})

afterEach(() => {
  for (const store of stores) store.dispose()
})

function storeOver(session: StorageAreaLike): MfeStorageStore {
  const store = new MfeStorageStore({
    areas: { local: createMemoryStorageArea(), session },
    diagnostics: new DiagnosticsHub(),
    eventTarget: null,
  })
  stores.push(store)
  return store
}

/** What a previous page load left behind for `identity`. */
function persisted(session: MemoryStorageArea): { identity: string; generation: string } | null {
  const raw = session.snapshot()[SESSION_GENERATION_KEY]
  if (raw === undefined) return null
  return (JSON.parse(raw) as { d: { identity: string; generation: string } }).d
}

describe('establishSessionGeneration', () => {
  it('mints one for a tab that has never opened a session, and persists it', () => {
    const session = createMemoryStorageArea()
    const store = storeOver(session)

    const generation = establishSessionGeneration(store, 'u-1')

    expect(generation).not.toBe('')
    expect(store.sessionGeneration).toBe(generation)
    expect(persisted(session)).toEqual({ identity: 'u-1', generation })
  })

  it('reuses the one in force across a reload of the same tab and identity', () => {
    const session = createMemoryStorageArea()
    const first = establishSessionGeneration(storeOver(session), 'u-1')

    // A reload: the tab's sessionStorage survives, everything in memory does not.
    const reloaded = storeOver(session)
    const second = establishSessionGeneration(reloaded, 'u-1')

    expect(second).toBe(first)
    expect(reloaded.sessionGeneration).toBe(first)
  })

  it('mints a fresh one when a different identity opens the tab', () => {
    const session = createMemoryStorageArea()
    const first = establishSessionGeneration(storeOver(session), 'u-1')
    const second = establishSessionGeneration(storeOver(session), 'u-2')

    expect(second).not.toBe(first)
    expect(persisted(session)).toEqual({ identity: 'u-2', generation: second })
  })

  it('records the identity beside the generation rather than inside it', () => {
    const session = createMemoryStorageArea()
    const generation = establishSessionGeneration(storeOver(session), 'u-1')

    expect(generation).not.toContain('u-1')
  })

  it('makes user-retained writes possible, which is the whole reason it exists', () => {
    const session = createMemoryStorageArea()
    const store = storeOver(session)
    const before = store.bind('acme-orders', { name: 'draft', schema: draftSchema })

    expect(() => before.set({ text: 'refused' })).toThrow(/session/)

    establishSessionGeneration(store, 'u-1')
    before.set({ text: 'accepted' })

    expect(before.read()).toEqual({ text: 'accepted' })
  })

  it('keeps the record out of the user-retained purge', () => {
    const session = createMemoryStorageArea()
    const store = storeOver(session)
    const generation = establishSessionGeneration(store, 'u-1')

    store.applySessionTransition({ kind: 'identity', reason: 'logout' }, 'gen-next')

    expect(persisted(session)).toEqual({ identity: 'u-1', generation })
  })

  it('mints anyway when the record is unreadable', () => {
    const session = createMemoryStorageArea({ [SESSION_GENERATION_KEY]: 'not json at all' })
    const store = storeOver(session)

    const generation = establishSessionGeneration(store, 'u-1')

    expect(store.sessionGeneration).toBe(generation)
    expect(persisted(session)).toEqual({ identity: 'u-1', generation })
  })

  it('establishes a generation even when the store cannot persist it', () => {
    const blocked: StorageAreaLike = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error('SecurityError: storage is blocked for this origin')
      },
      setItem: () => {
        throw new Error('SecurityError: storage is blocked for this origin')
      },
      removeItem: () => {},
    }
    const store = storeOver(blocked)

    const generation = establishSessionGeneration(store, 'u-1')

    // Nothing survives the reload, but every write this page makes is fenced by
    // a real generation instead of being refused one at a time.
    expect(generation).not.toBe('')
    expect(store.sessionGeneration).toBe(generation)
  })

  it('takes a mint the shell supplies, for a shell that coordinates tabs', () => {
    const session = createMemoryStorageArea()

    const generation = establishSessionGeneration(storeOver(session), 'u-1', {
      mint: () => 'tab-coordinated-7',
    })

    expect(generation).toBe('tab-coordinated-7')
  })
})
