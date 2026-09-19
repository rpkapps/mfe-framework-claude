import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { DiagnosticsHub, type Diagnostic, type StorageEnvelope } from '@company/mfe-core'

import { createMemoryStorageArea, type MemoryStorageArea } from '../testing/memory-storage-area.ts'
import { MfeStorageStore } from './storage-store.ts'

const ORDERS = 'acme-orders'
const themeSchema = z.enum(['light', 'dark'])
const draftSchema = z.string()

interface Harness {
  readonly store: MfeStorageStore
  readonly local: MemoryStorageArea
  readonly session: MemoryStorageArea
  readonly reported: Diagnostic[]
}

let created: MfeStorageStore[] = []

function harness(
  options: { readonly generation?: string | null; readonly groups?: readonly string[] } = {},
): Harness {
  const local = createMemoryStorageArea()
  const session = createMemoryStorageArea()
  const reported: Diagnostic[] = []
  const diagnostics = new DiagnosticsHub()
  diagnostics.add(diagnostic => reported.push(diagnostic))
  const generation = options.generation === undefined ? 'gen-1' : options.generation
  const store = new MfeStorageStore({
    areas: { local, session },
    diagnostics,
    ...(generation === null ? {} : { sessionGeneration: generation }),
    ...(options.groups === undefined ? {} : { groups: options.groups }),
    eventTarget: null,
  })
  created.push(store)
  return { store, local, session, reported }
}

function envelope(
  data: unknown,
  overrides: {
    readonly v?: number
    readonly r?: 'session' | 'preference'
    readonly g?: string
  } = {},
): string {
  const retention = overrides.r ?? 'session'
  return JSON.stringify({
    v: overrides.v ?? 1,
    r: retention,
    ...(retention === 'session' ? { g: overrides.g ?? 'gen-1' } : {}),
    d: data,
  })
}

function readEnvelope(area: MemoryStorageArea, key: string): StorageEnvelope {
  const raw = area.getItem(key)
  if (raw === null) throw new Error(`expected a record at ${key}`)
  return JSON.parse(raw) as StorageEnvelope
}

beforeEach(() => {
  created = []
})

afterEach(() => {
  for (const store of created) store.dispose()
  vi.restoreAllMocks()
})

/* -------------------------------------------------------------------------- */

describe('the persisted envelope', () => {
  it('stores schema version, retention and the opaque generation beside the payload', () => {
    const { store, local } = harness()
    const theme = store.bind(ORDERS, { name: 'theme', schema: themeSchema })

    theme.set('dark')

    const record = readEnvelope(local, 'acme-orders:theme')
    expect(Object.keys(record).sort()).toEqual(['d', 'g', 'r', 'v'])
    expect(record).toEqual({ v: 1, r: 'session', g: 'gen-1', d: 'dark' })
  })

  it('persists no generation for a preference record, and never a token or a group list', () => {
    const { store, local } = harness({ groups: ['finance', 'admin'] })
    const theme = store.bind(ORDERS, {
      name: 'theme',
      schema: themeSchema,
      retention: 'preference',
    })

    theme.set('dark')

    const raw = local.getItem('acme-orders:theme') ?? ''
    expect(JSON.parse(raw)).toEqual({ v: 1, r: 'preference', d: 'dark' })
    expect(raw).not.toMatch(/finance|admin|token/)
  })

  it('keeps retention independent of the store the value lives in', () => {
    const { store, local, session } = harness()
    const preferenceInSession = store.bind(ORDERS, {
      name: 'density',
      schema: z.string(),
      area: 'session',
      retention: 'preference',
    })
    const sessionInLocal = store.bind(ORDERS, {
      name: 'draft',
      schema: draftSchema,
      area: 'local',
      retention: 'session',
    })

    preferenceInSession.set('compact')
    sessionInLocal.set('half written')

    expect(readEnvelope(session, 'acme-orders:density').r).toBe('preference')
    expect(readEnvelope(session, 'acme-orders:density').g).toBeUndefined()
    expect(readEnvelope(local, 'acme-orders:draft')).toMatchObject({ r: 'session', g: 'gen-1' })
  })
})

describe('the generation must be established first', () => {
  it('refuses to read or write a session-retained value before a session is in force', () => {
    const { store, local } = harness({ generation: null })
    local.setItem('acme-orders:draft', envelope('half written'))

    const draft = store.bind(ORDERS, { name: 'draft', schema: draftSchema })

    expect(store.sessionGeneration).toBeNull()
    expect(draft.getSnapshot().status).toBe('error')
    expect(() => draft.read()).toThrow(/session generation to be established/)
    expect(() => draft.set('more')).toThrow(/session generation to be established/)
    expect(local.getItem('acme-orders:draft')).toBe(envelope('half written'))
  })

  it('lets a preference-retained value work with no session at all', () => {
    const { store } = harness({ generation: null })
    const theme = store.bind(ORDERS, {
      name: 'theme',
      schema: themeSchema,
      retention: 'preference',
      defaultValue: 'light',
    })

    theme.set('dark')

    expect(theme.getSnapshot()).toEqual({ status: 'value', value: 'dark' })
  })

  it('publishes stored session values once the shell establishes the generation', () => {
    const { store, local } = harness({ generation: null })
    local.setItem('acme-orders:draft', envelope('half written', { g: 'gen-7' }))
    const draft = store.bind(ORDERS, { name: 'draft', schema: draftSchema })
    const listener = vi.fn()
    draft.subscribe(listener)

    store.establishSession('gen-7')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(draft.getSnapshot()).toEqual({ status: 'value', value: 'half written' })
  })

  it('refuses to establish a second generation, or to reuse one already seen', () => {
    const { store } = harness()

    expect(() => store.establishSession('gen-2')).toThrow(/applySessionTransition/)
    store.applySessionTransition({ kind: 'identity', reason: 'logout' }, 'gen-2')
    expect(() =>
      store.applySessionTransition({ kind: 'identity', reason: 'login' }, 'gen-1'),
    ).toThrow(/never seen before/)
  })
})

describe('session transitions', () => {
  it('invalidates session records on logout and publishes the declared defaults', () => {
    const { store, local } = harness()
    const draft = store.bind(ORDERS, {
      name: 'draft',
      schema: draftSchema,
      defaultValue: 'untitled',
    })
    draft.set('customer notes')
    const listener = vi.fn()
    draft.subscribe(listener)

    const result = store.applySessionTransition({ kind: 'identity', reason: 'logout' }, 'gen-2')

    expect(result).toMatchObject({ outcome: 'invalidated', generation: 'gen-2' })
    expect(result.removedRecords).toBe(1)
    expect(result.notifiedKeys).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(draft.getSnapshot()).toEqual({ status: 'default', value: 'untitled' })
    expect(local.snapshot()).toEqual({})
  })

  it('retires the in-memory snapshot before it notifies anybody', () => {
    const { store } = harness()
    const draft = store.bind(ORDERS, {
      name: 'draft',
      schema: draftSchema,
      defaultValue: 'untitled',
    })
    draft.set('customer notes')
    const observed: unknown[] = []
    draft.subscribe(() => observed.push(draft.getSnapshot()))

    store.applySessionTransition({ kind: 'identity', reason: 'logout' }, 'gen-2')

    expect(observed).toEqual([{ status: 'default', value: 'untitled' }])
  })

  it('preserves preference records and does not disturb their subscribers', () => {
    const { store, local } = harness()
    const theme = store.bind(ORDERS, {
      name: 'theme',
      schema: themeSchema,
      retention: 'preference',
      defaultValue: 'light',
    })
    const draft = store.bind(ORDERS, { name: 'draft', schema: draftSchema })
    theme.set('dark')
    draft.set('customer notes')
    const themeListener = vi.fn()
    theme.subscribe(themeListener)
    const before = theme.getSnapshot()

    store.applySessionTransition({ kind: 'identity', reason: 'account' }, 'gen-2')

    expect(themeListener).not.toHaveBeenCalled()
    expect(theme.getSnapshot()).toBe(before)
    expect(local.getItem('acme-orders:theme')).not.toBeNull()
    expect(local.getItem('acme-orders:draft')).toBeNull()
  })

  it('invalidates records of definitions that are not currently mounted', () => {
    const { store, local, session } = harness()
    local.setItem('never-mounted:draft', envelope('someone else'))
    local.setItem('never-mounted:theme', envelope('dark', { r: 'preference' }))
    session.setItem('also-unmounted:step', envelope(3))
    local.setItem('third-party-widget', 'not a framework record')
    local.setItem('legacy:blob', '{"not":"an envelope"}')

    const result = store.applySessionTransition({ kind: 'identity', reason: 'tenant' }, 'gen-2')

    expect(result.removedRecords).toBe(2)
    expect(Object.keys(local.snapshot()).sort()).toEqual([
      'legacy:blob',
      'never-mounted:theme',
      'third-party-widget',
    ])
    expect(session.snapshot()).toEqual({})
  })

  it('treats a record as absent when the physical delete failed', () => {
    const { store, local, reported } = harness()
    const draft = store.bind(ORDERS, { name: 'draft', schema: draftSchema })
    draft.set('customer notes')
    vi.spyOn(local, 'removeItem').mockImplementation(() => {
      throw new DOMException('mutation blocked', 'InvalidAccessError')
    })

    store.applySessionTransition({ kind: 'identity', reason: 'logout' }, 'gen-2')

    expect(local.getItem('acme-orders:draft')).not.toBeNull()
    expect(draft.getSnapshot()).toEqual({ status: 'default', value: null })
    expect(store.storageFor(ORDERS).key('draft', draftSchema).get()).toBeNull()
    expect(reported.some(entry => entry.severity === 'warning')).toBe(true)
  })

  it('invalidates on a semantic group change but not on a reordered identical set', () => {
    const { store } = harness({ groups: ['finance', 'admin'] })
    const draft = store.bind(ORDERS, { name: 'draft', schema: draftSchema })
    draft.set('customer notes')

    const reorder = store.applySessionTransition({
      kind: 'groups',
      groups: ['admin', 'finance', 'admin'],
    })
    expect(reorder).toMatchObject({
      outcome: 'unchanged-group-set',
      generation: 'gen-1',
    })
    expect(draft.getSnapshot()).toEqual({ status: 'value', value: 'customer notes' })

    const change = store.applySessionTransition({ kind: 'groups', groups: ['finance'] }, 'gen-2')
    expect(change.outcome).toBe('invalidated')
    expect(draft.getSnapshot().status).toBe('default')
  })

  it('invalidates nothing for a theme change or a token refresh', () => {
    const { store } = harness()
    const draft = store.bind(ORDERS, { name: 'draft', schema: draftSchema })
    draft.set('customer notes')
    const listener = vi.fn()
    draft.subscribe(listener)

    expect(store.applySessionTransition({ kind: 'theme' })).toMatchObject({
      outcome: 'not-session-affecting',
      generation: 'gen-1',
    })
    expect(store.applySessionTransition({ kind: 'token-refresh' }).outcome).toBe(
      'not-session-affecting',
    )

    expect(listener).not.toHaveBeenCalled()
    expect(draft.getSnapshot()).toEqual({ status: 'value', value: 'customer notes' })
    expect(store.sessionGeneration).toBe('gen-1')
  })

  it('requires a fresh generation for an invalidating transition', () => {
    const { store } = harness()

    expect(() => store.applySessionTransition({ kind: 'identity', reason: 'logout' })).toThrow(
      /fresh opaque session generation/,
    )
    expect(() =>
      store.applySessionTransition({ kind: 'identity', reason: 'logout' }, 'gen-1'),
    ).toThrow(/never seen before/)
    expect(store.sessionGeneration).toBe('gen-1')
  })

  it('does not resurrect an invalidated generation when the user returns to it', () => {
    const { store, local } = harness({ groups: ['finance'] })
    const draft = store.bind(ORDERS, { name: 'draft', schema: draftSchema })
    draft.set('customer notes')

    store.applySessionTransition({ kind: 'groups', groups: ['finance', 'admin'] }, 'gen-2')
    // The shell must mint a new generation, even though the group set is the old one.
    expect(() =>
      store.applySessionTransition({ kind: 'groups', groups: ['finance'] }, 'gen-1'),
    ).toThrow(/never seen before/)
    store.applySessionTransition({ kind: 'groups', groups: ['finance'] }, 'gen-3')

    expect(local.snapshot()).toEqual({})
    expect(draft.getSnapshot().status).toBe('default')
  })

  it('counts only the keys whose value actually changed', () => {
    const { store } = harness()
    const untouched = store.bind(ORDERS, { name: 'draft', schema: draftSchema })
    const written = store.bind(ORDERS, { name: 'query', schema: z.string() })
    written.set('status:open')
    const untouchedBefore = untouched.getSnapshot()

    const result = store.applySessionTransition({ kind: 'identity', reason: 'logout' }, 'gen-2')

    expect(result.notifiedKeys).toBe(1)
    expect(untouched.getSnapshot()).toBe(untouchedBefore)
  })

  it('keeps an existing binding usable in the new session', () => {
    const { store, local } = harness()
    const draft = store.bind(ORDERS, { name: 'draft', schema: draftSchema })
    draft.set('customer notes')

    store.applySessionTransition({ kind: 'identity', reason: 'login' }, 'gen-2')
    draft.set('a new note')

    expect(readEnvelope(local, 'acme-orders:draft')).toEqual({
      v: 1,
      r: 'session',
      g: 'gen-2',
      d: 'a new note',
    })
  })
})

describe('generation fences', () => {
  it('rejects a write committed from a retired generation and leaves the value alone', () => {
    const { store, local } = harness()
    const draft = store.bind(ORDERS, { name: 'draft', schema: draftSchema })
    const inFlight = store.sessionGeneration ?? 'gen-1'
    draft.set('customer notes')

    store.applySessionTransition({ kind: 'identity', reason: 'logout' }, 'gen-2')

    expect(() => draft.set('late write', { generation: inFlight })).toThrow(
      /never commits into the new one/,
    )
    expect(() => draft.remove({ generation: inFlight })).toThrow(/never commits into the new one/)
    expect(local.snapshot()).toEqual({})
    expect(draft.getSnapshot().status).toBe('default')
  })

  it('accepts a write that names the generation currently in force', () => {
    const { store } = harness()
    const draft = store.bind(ORDERS, { name: 'draft', schema: draftSchema })

    store.applySessionTransition({ kind: 'identity', reason: 'account' }, 'gen-2')
    draft.set('fresh note', { generation: 'gen-2' })

    expect(draft.getSnapshot()).toEqual({ status: 'value', value: 'fresh note' })
  })

  it('ignores a late cross-tab record written by a retired session', () => {
    const { store, local } = harness()
    const draft = store.bind(ORDERS, { name: 'draft', schema: draftSchema })
    draft.set('customer notes')
    store.applySessionTransition({ kind: 'identity', reason: 'logout' }, 'gen-2')
    const listener = vi.fn()
    draft.subscribe(listener)

    const stale = envelope('an old tab caught up', { g: 'gen-1' })
    local.setItem('acme-orders:draft', stale)
    store.handleStorageEvent({ key: 'acme-orders:draft', newValue: stale, storageArea: local })

    expect(listener).not.toHaveBeenCalled()
    expect(draft.getSnapshot()).toEqual({ status: 'default', value: null })
    expect(store.storageFor(ORDERS).key('draft', draftSchema).get()).toBeNull()
  })

  it('accepts a cross-tab record written in the generation now in force', () => {
    const { store, local } = harness()
    const draft = store.bind(ORDERS, { name: 'draft', schema: draftSchema })
    store.applySessionTransition({ kind: 'identity', reason: 'login' }, 'gen-2')
    const listener = vi.fn()
    draft.subscribe(listener)

    const fresh = envelope('written next door', { g: 'gen-2' })
    local.setItem('acme-orders:draft', fresh)
    store.handleStorageEvent({ key: 'acme-orders:draft', newValue: fresh, storageArea: local })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(draft.getSnapshot()).toEqual({ status: 'value', value: 'written next door' })
  })
})
