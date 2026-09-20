/**
 * The reserved host scope: state the page owns rather than any definition on it.
 *
 * The behaviour worth pinning is the part a shell was hand-rolling before it
 * existed — that a host record is a framework record like any other, that
 * nothing retires it when it says so, and that it is reachable with no mount
 * and no session in force.
 */

import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { z } from 'zod'

import { DiagnosticsHub, HOST_SCOPE, isMfeError, type Diagnostic } from '@company/mfe-core'

import { createMemoryStorageArea, type MemoryStorageArea } from '../testing/memory-storage-area.ts'
import { MfeStorageStore } from './storage-store.ts'

const themeSchema = z.enum(['light', 'dark'])
const layoutSchema = z.object({ tiles: z.array(z.string()) })

interface Harness {
  readonly store: MfeStorageStore
  readonly local: MemoryStorageArea
  readonly session: MemoryStorageArea
  readonly reported: Diagnostic[]
}

let stores: MfeStorageStore[] = []

beforeEach(() => {
  stores = []
})

afterEach(() => {
  for (const store of stores) store.dispose()
})

function harness(options: { readonly generation?: string } = {}): Harness {
  const local = createMemoryStorageArea()
  const session = createMemoryStorageArea()
  const reported: Diagnostic[] = []
  const diagnostics = new DiagnosticsHub()
  diagnostics.add(diagnostic => reported.push(diagnostic))
  const store = new MfeStorageStore({
    areas: { local, session },
    diagnostics,
    ...(options.generation === undefined ? {} : { sessionGeneration: options.generation }),
    eventTarget: null,
  })
  stores.push(store)
  return { store, local, session, reported }
}

describe('the reserved host scope', () => {
  it('writes under @host: and inside no definition space', () => {
    const { store, local } = harness({ generation: 'gen-1' })

    const theme = store.bindHost({ name: 'theme', schema: themeSchema, retention: 'browser' })
    theme.set('light')

    expect(theme.key).toBe('@host:theme')
    expect(theme.definitionId).toBe(HOST_SCOPE)
    expect(Object.keys(local.snapshot())).toEqual(['@host:theme'])
    expect(JSON.parse(local.snapshot()['@host:theme'] ?? 'null')).toEqual({
      v: 1,
      r: 'browser',
      d: 'light',
    })
  })

  it('is usable before any session is established, when it is browser-retained', () => {
    const { store } = harness()

    const theme = store.bindHost({ name: 'theme', schema: themeSchema, retention: 'browser' })
    theme.set('dark')

    expect(store.sessionGeneration).toBeNull()
    expect(theme.read()).toBe('dark')
  })

  it('survives the purge that retires every user-retained record', () => {
    const { store, local } = harness({ generation: 'gen-1' })

    const theme = store.bindHost({ name: 'theme', schema: themeSchema, retention: 'browser' })
    const filters = store.bind('acme-orders', { name: 'filters', schema: layoutSchema })
    theme.set('light')
    filters.set({ tiles: ['a'] })

    const result = store.applySessionTransition({ kind: 'identity', reason: 'logout' }, 'gen-2')

    expect(result.outcome).toBe('invalidated')
    expect(result.removedRecords).toBe(1)
    expect(Object.keys(local.snapshot())).toEqual(['@host:theme'])
    expect(theme.read()).toBe('light')
  })

  it('validates a host write against the declared schema like any other key', () => {
    const { store, reported } = harness({ generation: 'gen-1' })

    const theme = store.bindHost({ name: 'theme', schema: themeSchema, retention: 'browser' })

    expect(() => theme.set('sepia' as 'light')).toThrow(/theme/)
    expect(theme.getSnapshot()).toEqual({ status: 'default', value: null })
    expect(reported.some(diagnostic => diagnostic.error.code === 'storage/failure')).toBe(true)
  })

  it('migrates a record written before the key was versioned', () => {
    const { store, local } = harness({ generation: 'gen-1' })
    local.setItem('@host:dashboard', JSON.stringify({ tiles: ['alert-panel'] }))

    const layout = store.bindHost({
      name: 'dashboard',
      schema: layoutSchema,
      retention: 'browser',
      defaultValue: { tiles: [] },
      migrate: value => layoutSchema.parse(value),
    })

    expect(layout.read()).toEqual({ tiles: ['alert-panel'] })
    expect(JSON.parse(local.snapshot()['@host:dashboard'] ?? 'null')).toEqual({
      v: 1,
      r: 'browser',
      d: { tiles: ['alert-panel'] },
    })
  })

  it('applies a cross-tab write to the host key', () => {
    const { store, local } = harness({ generation: 'gen-1' })
    const theme = store.bindHost({ name: 'theme', schema: themeSchema, retention: 'browser' })
    theme.set('light')

    let notified = 0
    theme.subscribe(() => {
      notified += 1
    })

    store.handleStorageEvent({
      key: '@host:theme',
      newValue: JSON.stringify({ v: 1, r: 'browser', d: 'dark' }),
      storageArea: local,
    })

    expect(notified).toBe(1)
    expect(theme.read()).toBe('dark')
  })

  it('does not collide with a definition that uses the same key name', () => {
    const { store, local } = harness({ generation: 'gen-1' })

    const host = store.bindHost({ name: 'theme', schema: themeSchema, retention: 'browser' })
    const definition = store.bind('acme-orders', { name: 'theme', schema: themeSchema })
    host.set('light')
    definition.set('dark')

    expect(host.read()).toBe('light')
    expect(definition.read()).toBe('dark')
    expect(Object.keys(local.snapshot()).sort()).toEqual(['@host:theme', 'acme-orders:theme'])
  })
})

describe('reaching the host scope through the definition surface', () => {
  it('is refused by bind(), so "belongs to the page" is declared and not guessed', () => {
    const { store } = harness({ generation: 'gen-1' })

    expect(() => store.bind(HOST_SCOPE, { name: 'theme', schema: themeSchema })).toThrow(/bindHost/)
  })

  it('is refused by storageFor() and clearDefinition() for the same reason', () => {
    const { store } = harness({ generation: 'gen-1' })

    expect(() => store.storageFor(HOST_SCOPE)).toThrow(/hostStorage/)
    expect(() => store.clearDefinition(HOST_SCOPE)).toThrow(/hostStorage/)
  })

  it('reports the refusal as a structured storage failure', () => {
    const { store, reported } = harness({ generation: 'gen-1' })

    try {
      store.storageFor(HOST_SCOPE)
    } catch (error) {
      expect(isMfeError(error)).toBe(true)
    }
    expect(reported.at(-1)?.error.code).toBe('storage/failure')
  })

  it('cannot be reached by a registry id, because a definition id has no "@"', () => {
    const { store, local } = harness({ generation: 'gen-1' })

    // The nearest legal id, to show it lands somewhere else entirely.
    store.bind('host', { name: 'theme', schema: themeSchema }).set('dark')

    expect(Object.keys(local.snapshot())).toEqual(['host:theme'])
  })
})

describe('the host imperative surface', () => {
  it('reads, writes and clears only the host prefix', () => {
    const { store, local } = harness({ generation: 'gen-1' })
    const host = store.hostStorage()
    const definition = store.storageFor('acme-orders')

    host.key('theme', themeSchema, { retention: 'browser' }).set('light')
    definition.key('theme', themeSchema).set('dark')

    expect(host.key('theme', themeSchema, { retention: 'browser' }).get()).toBe('light')

    host.clear()

    expect(Object.keys(local.snapshot())).toEqual(['acme-orders:theme'])
  })
})
