/**
 * Every adapter's test environment stands on this runtime, so it has to behave like the one a
 * shell builds — registry, loader, session fencing — with nothing behind it but memory, and no
 * state shared between two of them.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  createMfeError,
  DEFINITION_BRAND,
  type BrandedDefinition,
  type DefinitionKind,
  type MfeAdapter,
  type RegistryEntry,
  storedKey,
} from '@company/mfe-core'

import { createMemoryRuntime, type MemoryRuntime } from './memory-runtime.ts'

const created: MemoryRuntime[] = []

afterEach(() => {
  for (const memory of created.splice(0)) memory.dispose()
})

function memoryRuntime(options: Parameters<typeof createMemoryRuntime>[0] = {}): MemoryRuntime {
  const memory = createMemoryRuntime(options)
  created.push(memory)
  return memory
}

function definition(
  id: string,
  kind: DefinitionKind,
  framework: string,
  version?: string,
): BrandedDefinition {
  return {
    [DEFINITION_BRAND]: true,
    kind,
    id,
    framework,
    requiresRuntime: '>=1.1.0 <2.0.0',
    ...(version === undefined ? {} : { version }),
  }
}

const liveSignal = (): AbortSignal => new AbortController().signal

/** Recognises entries marked `published`, standing in for an adapter's own reading. */
const publishedAdapter: MfeAdapter = {
  kind: 'published',
  detect: raw => raw !== null && typeof raw === 'object' && 'published' in raw,
  parse: raw => {
    const record = raw as Record<string, unknown>
    const id = String(record['id'])
    return {
      id,
      definitionKind: record['kind'] === 'widget' ? 'widget' : 'app',
      adapter: 'published',
      manifestUrl: `https://cdn.example.test/${id}/mf-manifest.json`,
      requiresRuntime: '>=1.1.0 <2.0.0',
      container: typeof record['container'] === 'string' ? record['container'] : id,
    }
  },
  is: (entry): entry is RegistryEntry => entry.adapter === 'published',
}

describe('createMemoryRuntime', () => {
  it('lists each definition under its own id, as the adapter that built it would', () => {
    const { runtime } = memoryRuntime({
      definitions: [
        definition('reports', 'app', 'react'),
        definition('alert-panel', 'widget', 'angular'),
      ],
    })

    expect(runtime.registry.rejected).toEqual([])
    expect(runtime.registry.entries.get('reports')).toMatchObject({
      definitionKind: 'app',
      adapter: 'react',
      container: 'reports',
    })
    expect(runtime.registry.entries.get('alert-panel')).toMatchObject({
      definitionKind: 'widget',
      adapter: 'angular',
      container: 'alert_panel',
    })
  })

  it('loads the definitions it was handed, with their identity', async () => {
    const panel = definition('alert-panel', 'widget', 'angular', '1.4.0')
    const { runtime } = memoryRuntime({ definitions: [panel] })
    const entry = runtime.registry.entries.get('alert-panel')
    if (!entry) throw new Error('expected the Widget to be registered')

    const loaded = await runtime.loader.load(entry, { signal: liveSignal() })

    expect(loaded.module).toBe(panel)
    expect(loaded.identity).toEqual({ id: 'alert-panel', kind: 'widget', version: '1.4.0' })
  })

  it('reads published entries through the adapters it is handed, over what a definition implies', () => {
    const { runtime } = memoryRuntime({
      definitions: [definition('reports', 'app', 'react')],
      adapters: [publishedAdapter],
      registryEntries: [
        {
          id: 'reports',
          published: true,
          requiresRuntime: '>=1.1.0 <2.0.0',
          container: 'reports_remote',
        },
      ],
    })

    expect(runtime.registry.entries.get('reports')).toMatchObject({
      adapter: 'published',
      container: 'reports_remote',
    })
  })

  it('rejects and reports an entry no adapter recognised, as a shell does', () => {
    const { runtime, diagnostics } = memoryRuntime({
      adapters: [publishedAdapter],
      registryEntries: [{ id: 'stray', requiresRuntime: '>=1.1.0 <2.0.0' }],
    })

    expect(runtime.registry.entries.has('stray')).toBe(false)
    expect(runtime.registry.rejected.map(rejected => rejected.id)).toEqual(['stray'])
    expect(diagnostics.map(diagnostic => diagnostic.error.code)).toEqual(['registry/invalid-entry'])
  })

  it('runs each load inside the aroundLoad of the adapter that parsed its entry', async () => {
    const aroundLoad = vi.fn((load: () => Promise<unknown>) => load())
    const panel = definition('alert-panel', 'widget', 'angular')
    const { runtime } = memoryRuntime({
      definitions: [panel],
      adapters: [
        { ...publishedAdapter, aroundLoad: aroundLoad as NonNullable<MfeAdapter['aroundLoad']> },
      ],
      registryEntries: [
        { id: 'alert-panel', published: true, requiresRuntime: '>=1.1.0 <2.0.0', kind: 'widget' },
      ],
    })
    const entry = runtime.registry.entries.get('alert-panel')
    if (!entry) throw new Error('expected the Widget to be registered')

    const loaded = await runtime.loader.load(entry, { signal: liveSignal() })

    expect(loaded.module).toBe(panel)
    expect(aroundLoad).toHaveBeenCalledTimes(1)
  })

  it('carries the default deadlines, merged with any it is given', () => {
    expect(memoryRuntime().runtime.deadlines).toEqual({
      load: 30_000,
      mount: 30_000,
      dispose: 5_000,
    })
    expect(memoryRuntime({ deadlines: { mount: 50 } }).runtime.deadlines.mount).toBe(50)
  })

  /** `null` is a signed-out page rather than a missing value, so it is not replaced. */
  it('starts signed in as a test user on the light theme, unless told otherwise', () => {
    const defaults = memoryRuntime()
    const dark = memoryRuntime({ shellState: { theme: 'dark', user: null } })

    expect(defaults.runtime.shellState.getSnapshot()).toMatchObject({
      user: { id: 'test-user' },
      groups: ['testers'],
      theme: 'light',
    })
    expect(dark.runtime.shellState.getSnapshot()).toMatchObject({
      user: null,
      groups: ['testers'],
      theme: 'dark',
    })
  })

  it('starts the navigation where it is told to', () => {
    const { runtime, navigation } = memoryRuntime({ initialEntries: ['/reports/a'] })

    expect(runtime.navigator.read().pathname).toBe('/reports/a')
    expect(navigation.read().pathname).toBe('/reports/a')
  })

  it('records everything reported to the runtime, in order', () => {
    const { runtime, diagnostics } = memoryRuntime()
    const failure = (id: string) =>
      createMfeError({ code: 'mount/failure', id, operation: 'mount', repair: 'Retry.' })

    runtime.diagnostics.report(failure('first'))
    runtime.diagnostics.report(failure('second'), { severity: 'warning' })

    expect(diagnostics.map(diagnostic => diagnostic.error.id)).toEqual(['first', 'second'])
  })

  it('shares no storage with another runtime', async () => {
    const first = memoryRuntime()
    const second = memoryRuntime()
    const density = storedKey('density', z.string().default('comfortable'))

    await first.runtime.storage.forCaller({ owner: 'reports' }).set(density, 'compact')

    expect(second.runtime.storage.forCaller({ owner: 'reports' }).peek(density)).toBe('comfortable')
    expect(first.storageAreas.local.length).toBe(1)
    expect(second.storageAreas.local.length).toBe(0)
  })

  describe('seeded storage values', () => {
    const units = storedKey('units', z.enum(['metric', 'imperial']).default('metric'), {
      storage: 'user',
    })
    const sidebar = storedKey('sidebar-open', z.boolean().default(true))
    const zoom = storedKey('zoom', z.number().default(1), { storage: 'session', perInstance: true })
    const tile = storedKey('tile', z.string().default('small'), {
      storage: 'user',
      perInstance: true,
    })

    it('seeds user and local values for the only definition it was handed', async () => {
      const { runtime, userStorage, storageAreas } = memoryRuntime({
        definitions: [definition('reports', 'app', 'react')],
        storage: {
          values: [
            [units, 'imperial'],
            [sidebar, false],
          ],
        },
      })
      const storage = runtime.storage.forCaller({ owner: 'reports' })

      expect(await storage.get(units)).toBe('imperial')
      expect(storage.status(units)).toBe('ready')
      expect(storage.peek(sidebar)).toBe(false)
      expect(userStorage?.snapshot()).toEqual({
        reports: { units: { v: 1, d: 'imperial', revision: 1 } },
      })
      expect(storageAreas.local.length).toBe(1)
    })

    it('seeds per-instance values and values of a named owner, else the host', async () => {
      const labUnits = storedKey.from(
        'lab',
        'units',
        z.enum(['metric', 'imperial']).default('metric'),
        {
          storage: 'user',
        },
      )
      const { runtime, userStorage } = memoryRuntime({
        storage: {
          values: [
            [labUnits, 'imperial'],
            [units, 'imperial'],
            [tile, 'large', { owner: 'board', instanceId: 'north' }],
            [zoom, 3, { owner: 'board', instanceId: 'north' }],
            [sidebar, false],
          ],
        },
      })
      await runtime.storage.whenLoaded()

      expect(userStorage?.snapshot()).toEqual({
        lab: { units: { v: 1, d: 'imperial', revision: 1 } },
        '@host': { units: { v: 1, d: 'imperial', revision: 1 } },
        board: { 'tile@north': { v: 1, d: 'large', revision: 1 } },
      })
      const north = runtime.storage.forCaller({ owner: 'board', instanceId: 'north' })
      const south = runtime.storage.forCaller({ owner: 'board', instanceId: 'south' })
      expect(north.peek(tile)).toBe('large')
      expect(north.peek(zoom)).toBe(3)
      expect(south.peek(tile)).toBe('small')
      expect(south.peek(zoom)).toBe(1)
      expect(runtime.storage.forCaller({ owner: 'fieldwork' }).peek(labUnits)).toBe('imperial')
      expect(runtime.storage.forCaller({ owner: '@host' }).peek(sidebar)).toBe(false)
    })

    it('refuses a seed that fails the key’s schema', () => {
      expect(() => memoryRuntime({ storage: { values: [[units, 'si']] } })).toThrow()
      expect(() => memoryRuntime({ storage: { values: [[sidebar, 'open']] } })).toThrow()
    })
  })

  it('drops every blocker once disposed, as a shell’s does', () => {
    const memory = createMemoryRuntime()
    memory.runtime.navigator.registerBlocker('reports#1', {
      depth: 1,
      shouldBlock: () => true,
      confirm: () => Promise.resolve('proceed'),
    })

    memory.dispose()

    expect(memory.runtime.navigator.blockerCount).toBe(0)
  })
})
