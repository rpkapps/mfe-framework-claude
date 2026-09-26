/**
 * What matters is what the shell was hand-rolling: a reload of the same tab keeps the
 * generation, a different identity or group set never reuses one, and a store that cannot
 * persist still ends up with one in force.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { DiagnosticsHub } from '../diagnostics.ts'

import { createMemoryStorageArea, type MemoryStorageArea } from '../testing/memory-storage-area.ts'
import {
  establishSessionGeneration,
  recordSessionGeneration,
  SESSION_GENERATION_KEY,
} from './session-generation.ts'
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

interface PersistedRecord {
  readonly identity: string
  readonly groups?: readonly string[]
  readonly generation: string
}

/** What a previous page load left behind for `identity`. */
function persisted(session: MemoryStorageArea): PersistedRecord | null {
  const raw = session.snapshot()[SESSION_GENERATION_KEY]
  if (raw === undefined) return null
  return (JSON.parse(raw) as { d: PersistedRecord }).d
}

describe('establishSessionGeneration', () => {
  it('mints one for a tab that has never opened a session, and persists it', () => {
    const session = createMemoryStorageArea()
    const store = storeOver(session)

    const { generation } = establishSessionGeneration(store, 'u-1', ['ops'])

    expect(generation).not.toBe('')
    expect(store.sessionGeneration).toBe(generation)
    expect(persisted(session)).toEqual({ identity: 'u-1', groups: ['ops'], generation })
  })

  it('reuses the one in force across a reload of the same tab and identity', () => {
    const session = createMemoryStorageArea()
    const { generation: first } = establishSessionGeneration(storeOver(session), 'u-1', ['ops'])

    // A reload: the tab's sessionStorage survives, everything in memory does not.
    const reloaded = storeOver(session)
    const { generation: second } = establishSessionGeneration(reloaded, 'u-1', ['ops'])

    expect(second).toBe(first)
    expect(reloaded.sessionGeneration).toBe(first)
  })

  it('mints a fresh one when a different identity opens the tab', () => {
    const session = createMemoryStorageArea()
    const { generation: first } = establishSessionGeneration(storeOver(session), 'u-1', ['ops'])
    const { generation: second } = establishSessionGeneration(storeOver(session), 'u-2', ['ops'])

    expect(second).not.toBe(first)
    expect(persisted(session)).toEqual({ identity: 'u-2', groups: ['ops'], generation: second })
  })

  it('names the identity the record was written for when another one opens the tab', () => {
    const session = createMemoryStorageArea()
    establishSessionGeneration(storeOver(session), 'u-1', ['ops'])

    const changed = establishSessionGeneration(storeOver(session), 'u-2', ['ops'])
    const same = establishSessionGeneration(storeOver(session), 'u-2', ['admins'])

    expect(changed.previousIdentity).toBe('u-1')
    expect(same.previousIdentity).toBeNull()
  })

  it('names no previous identity for a tab that has no record', () => {
    const { previousIdentity } = establishSessionGeneration(
      storeOver(createMemoryStorageArea()),
      'u-1',
      ['ops'],
    )

    expect(previousIdentity).toBeNull()
  })

  /** Sign-in happens before boot, so a reload is where the shell first sees new groups. */
  it('mints a fresh one when the same identity reloads with different groups', () => {
    const session = createMemoryStorageArea()
    const { generation: first } = establishSessionGeneration(storeOver(session), 'u-1', ['ops'])

    const { generation: second } = establishSessionGeneration(storeOver(session), 'u-1', [
      'ops',
      'admins',
    ])

    expect(second).not.toBe(first)
    expect(persisted(session)).toEqual({
      identity: 'u-1',
      groups: ['admins', 'ops'],
      generation: second,
    })
  })

  it('reuses the one in force for the same group set in any order, with duplicates', () => {
    const session = createMemoryStorageArea()
    const { generation: first } = establishSessionGeneration(storeOver(session), 'u-1', [
      'ops',
      'admins',
    ])

    const { generation: second } = establishSessionGeneration(storeOver(session), 'u-1', [
      'admins',
      'ops',
      'admins',
    ])

    expect(second).toBe(first)
  })

  it('mints a fresh one over a record written before groups were recorded', () => {
    const session = createMemoryStorageArea()
    const { generation: first } = establishSessionGeneration(storeOver(session), 'u-1', ['ops'])
    const raw = session.getItem(SESSION_GENERATION_KEY) ?? ''
    const envelope = JSON.parse(raw) as { d: PersistedRecord }
    session.setItem(
      SESSION_GENERATION_KEY,
      JSON.stringify({ ...envelope, d: { identity: 'u-1', generation: first } }),
    )

    const { generation: second } = establishSessionGeneration(storeOver(session), 'u-1', ['ops'])

    expect(second).not.toBe(first)
    expect(persisted(session)).toEqual({ identity: 'u-1', groups: ['ops'], generation: second })
  })

  it('records the identity beside the generation rather than inside it', () => {
    const session = createMemoryStorageArea()
    const { generation } = establishSessionGeneration(storeOver(session), 'u-1', ['ops'])

    expect(generation).not.toContain('u-1')
  })

  it('makes user-retained writes possible, which is the whole reason it exists', () => {
    const session = createMemoryStorageArea()
    const store = storeOver(session)
    const before = store.bind('acme-orders', {
      name: 'draft',
      schema: draftSchema,
      retention: 'user',
    })

    expect(() => before.set({ text: 'refused' })).toThrow(/session/)

    establishSessionGeneration(store, 'u-1', ['ops'])
    before.set({ text: 'accepted' })

    expect(before.read()).toEqual({ text: 'accepted' })
  })

  it('keeps the record out of the user-retained purge', () => {
    const session = createMemoryStorageArea()
    const store = storeOver(session)
    const { generation } = establishSessionGeneration(store, 'u-1', ['ops'])

    store.applySessionTransition({ kind: 'identity', reason: 'logout' }, 'gen-next')

    expect(persisted(session)).toEqual({ identity: 'u-1', groups: ['ops'], generation })
  })

  it('mints anyway when the record is unreadable', () => {
    const session = createMemoryStorageArea({ [SESSION_GENERATION_KEY]: 'not json at all' })
    const store = storeOver(session)

    const { generation } = establishSessionGeneration(store, 'u-1', ['ops'])

    expect(store.sessionGeneration).toBe(generation)
    expect(persisted(session)).toEqual({ identity: 'u-1', groups: ['ops'], generation })
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

    const { generation } = establishSessionGeneration(store, 'u-1', ['ops'])

    expect(generation).not.toBe('')
    expect(store.sessionGeneration).toBe(generation)
  })

  it('takes a mint the shell supplies, for a shell that coordinates tabs', () => {
    const session = createMemoryStorageArea()

    const { generation } = establishSessionGeneration(storeOver(session), 'u-1', ['ops'], {
      mint: () => 'tab-coordinated-7',
    })

    expect(generation).toBe('tab-coordinated-7')
  })
})

describe('recordSessionGeneration', () => {
  it('makes a reload establish the generation a transition minted, not the one it retired', () => {
    const session = createMemoryStorageArea()
    const store = storeOver(session)
    const { generation: retired } = establishSessionGeneration(store, 'u-1', ['ops'])
    store.applySessionTransition({ kind: 'groups', groups: ['ops', 'admins'] }, 'gen-next')

    recordSessionGeneration(store, 'u-1', ['ops', 'admins'], 'gen-next')
    const { generation: reloaded } = establishSessionGeneration(storeOver(session), 'u-1', [
      'admins',
      'ops',
    ])

    expect(reloaded).toBe('gen-next')
    expect(reloaded).not.toBe(retired)
  })
})
