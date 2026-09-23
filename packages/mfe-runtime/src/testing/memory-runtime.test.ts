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
  type DefinitionFramework,
  type DefinitionKind,
  type MfeAdapter,
  type RegistryEntry,
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
  framework: DefinitionFramework,
  version?: string,
): BrandedDefinition {
  return {
    [DEFINITION_BRAND]: true,
    kind,
    id,
    framework,
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
      registryEntries: [{ id: 'reports', published: true, container: 'reports_remote' }],
    })

    expect(runtime.registry.entries.get('reports')).toMatchObject({
      adapter: 'published',
      container: 'reports_remote',
    })
  })

  it('rejects and reports an entry no adapter recognised, as a shell does', () => {
    const { runtime, diagnostics } = memoryRuntime({
      adapters: [publishedAdapter],
      registryEntries: [{ id: 'stray' }],
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
      registryEntries: [{ id: 'alert-panel', published: true, kind: 'widget' }],
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

  it('retires the storage session the way a shell does when the user changes', () => {
    const memory = memoryRuntime({ sessionGeneration: 'gen-1' })

    memory.setShellState({ user: { id: 'grace', name: 'Grace' } })

    expect(memory.runtime.storage.sessionGeneration).not.toBe('gen-1')
    expect(memory.runtime.storage.sessionGeneration).not.toBeNull()
  })

  it('records everything reported to the runtime, in order', () => {
    const { runtime, diagnostics } = memoryRuntime()
    const failure = (id: string) =>
      createMfeError({ code: 'mount/failure', id, operation: 'mount', repair: 'Retry.' })

    runtime.diagnostics.report(failure('first'))
    runtime.diagnostics.report(failure('second'), { severity: 'warning' })

    expect(diagnostics.map(diagnostic => diagnostic.error.id)).toEqual(['first', 'second'])
  })

  it('shares no storage with another runtime', () => {
    const first = memoryRuntime()
    const second = memoryRuntime()

    first.runtime.storage.storageFor('reports', 'local').key('density', z.string()).set('compact')

    expect(
      second.runtime.storage.storageFor('reports', 'local').key('density', z.string()).get(),
    ).toBeNull()
    expect(first.storageAreas.local.length).toBe(1)
    expect(second.storageAreas.local.length).toBe(0)
  })

  it('stops following the shell state once disposed', () => {
    const memory = createMemoryRuntime({ sessionGeneration: 'gen-1' })

    memory.dispose()
    memory.setShellState({ user: { id: 'grace', name: 'Grace' } })

    expect(memory.runtime.storage.sessionGeneration).toBe('gen-1')
  })
})
