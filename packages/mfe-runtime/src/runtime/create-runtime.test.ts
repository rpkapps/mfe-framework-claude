/**
 * The runtime every adapter's host surface builds on: it reads the registry through exactly the
 * adapters it is handed, reports what it rejected, fences storage by session, and on disposal
 * releases what it created and nothing it was lent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createMfeError,
  type Diagnostic,
  type MfeAdapter,
  type RegistryEntry,
} from '@company/mfe-core'

import { DEFAULT_DEADLINES } from '../deadline.ts'
import { DiagnosticsHub } from '../diagnostics.ts'
import { SharedContainerLoader } from '../loader/container-loader.ts'
import { OVERRIDES_STORAGE_KEY } from '../overrides/dev-overrides.ts'
import { createInProcessLoader } from '../testing/in-process-loader.ts'
import { createMemoryNavigationBridge } from '../testing/memory-navigation-bridge.ts'
import { createNoopTelemetryProvider } from '../telemetry/tracer.ts'
import {
  createMfeRuntime,
  type CreateMfeRuntimeOptions,
  type MfeRuntimeHandle,
} from './create-runtime.ts'

/** Recognises entries carrying a `kind` of its own name, and names their container. */
function adapterFor(kind: string): MfeAdapter {
  return {
    kind,
    detect: raw =>
      raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>)['kind'] === kind,
    parse: raw => {
      const record = raw as Record<string, unknown>
      if (typeof record['url'] !== 'string') {
        throw createMfeError({
          code: 'registry/invalid-entry',
          id: String(record['id']),
          operation: `read ${kind} registry entry`,
          expected: 'a url',
          observed: 'none',
          repair: 'Publish the url.',
        })
      }
      return {
        id: String(record['id']),
        definitionKind: 'app',
        adapter: kind,
        manifestUrl: record['url'],
        container: String(record['container'] ?? record['id']),
      }
    },
    is: (entry): entry is RegistryEntry => entry.adapter === kind,
  }
}

const first = adapterFor('first')
const second = adapterFor('second')

function published(id: string, kind: string, extra: Record<string, unknown> = {}): unknown {
  return { id, kind, url: `https://cdn.example.test/${id}/mf-manifest.json`, ...extra }
}

function overridesOf(value: Record<string, string> | string): Pick<Storage, 'getItem'> {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return { getItem: key => (key === OVERRIDES_STORAGE_KEY ? text : null) }
}

let handle: MfeRuntimeHandle | null = null
let recorded: Diagnostic[] = []

beforeEach(() => {
  recorded = []
})

afterEach(() => {
  handle?.dispose()
  handle = null
  sessionStorage.clear()
})

/** Everything but the session generation, which most tests fix and one leaves to the runtime. */
function baseOptions(): Omit<CreateMfeRuntimeOptions, 'sessionGeneration'> {
  return {
    registryEntries: [],
    loader: createInProcessLoader(new Map()),
    shellState: { user: { id: 'ada', name: 'Ada' }, groups: ['ops'], theme: 'dark' },
    telemetryProvider: createNoopTelemetryProvider(),
    navigationBridge: createMemoryNavigationBridge(['/']),
    diagnosticsSinks: [diagnostic => recorded.push(diagnostic)],
    adapters: [first, second],
  }
}

function create(options: Partial<CreateMfeRuntimeOptions> = {}): MfeRuntimeHandle {
  handle = createMfeRuntime({ ...baseOptions(), sessionGeneration: 'gen-1', ...options })
  return handle
}

describe('reading the registry', () => {
  it('reads each entry through the one adapter that recognises it', () => {
    const { runtime } = create({
      registryEntries: [published('reports', 'first'), published('feed', 'second')],
    })

    expect(runtime.registry.rejected).toEqual([])
    expect(runtime.registry.entries.get('reports')?.adapter).toBe('first')
    expect(runtime.registry.entries.get('feed')?.adapter).toBe('second')
  })

  /** Each adapter's own host surface decides what joins the list; the runtime adds nothing. */
  it('registers no adapter it was not handed', () => {
    const { runtime } = create({
      registryEntries: [published('reports', 'first')],
      adapters: [second],
    })

    expect(runtime.registry.entries.size).toBe(0)
    expect(runtime.registry.rejected[0]?.reason).toBe('no adapter recognised this entry')
  })

  it('reports each rejected entry and keeps the valid ones', () => {
    const { runtime } = create({
      registryEntries: [published('reports', 'first'), { id: 'broken', kind: 'first' }],
    })

    expect([...runtime.registry.entries.keys()]).toEqual(['reports'])
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      severity: 'error',
      error: { code: 'registry/invalid-entry', id: 'broken' },
      context: { entry: 'broken', reason: 'the first adapter rejected this entry' },
    })
  })

  it('shares one load between concurrent callers', () => {
    const { runtime } = create()

    expect(runtime.loader).toBeInstanceOf(SharedContainerLoader)
  })
})

describe('the adapter load hook', () => {
  /** Loads whatever `modules` holds for an id, counting how often it actually ran. */
  function countingLoader(modules: Readonly<Record<string, unknown>>) {
    const load = vi.fn((entry: RegistryEntry) =>
      Promise.resolve({
        identity: { id: entry.id, kind: entry.definitionKind },
        module: modules[entry.id],
      }),
    )
    return { load, loader: { load } }
  }

  const liveSignal = (): AbortSignal => new AbortController().signal

  it('runs each load inside the hook of the adapter that parsed its entry, and no other', async () => {
    const seen: string[] = []
    const hooked: MfeAdapter = {
      ...first,
      aroundLoad: async (load, entry) => {
        seen.push(`before ${entry.id}`)
        try {
          return await load()
        } finally {
          seen.push(`after ${entry.id}`)
        }
      },
    }
    const { loader, load } = countingLoader({ reports: 'reports module', feed: 'feed module' })
    const { runtime } = create({
      adapters: [hooked, second],
      loader,
      registryEntries: [published('reports', 'first'), published('feed', 'second')],
    })
    const entryFor = (id: string): RegistryEntry => {
      const entry = runtime.registry.entries.get(id)
      if (!entry) throw new Error(`expected ${id} in the registry`)
      return entry
    }

    const reports = await runtime.loader.load(entryFor('reports'), { signal: liveSignal() })
    await runtime.loader.load(entryFor('feed'), { signal: liveSignal() })

    expect(reports.module).toBe('reports module')
    expect(seen).toEqual(['before reports', 'after reports'])
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('runs once for a load many callers share', async () => {
    const aroundLoad = vi.fn((load: () => Promise<unknown>) => load())
    const { loader, load } = countingLoader({ reports: 'reports module' })
    const { runtime } = create({
      adapters: [{ ...first, aroundLoad: aroundLoad as NonNullable<MfeAdapter['aroundLoad']> }],
      loader,
      registryEntries: [published('reports', 'first')],
    })
    const entry = runtime.registry.entries.get('reports')
    if (!entry) throw new Error('expected reports in the registry')

    await Promise.all([
      runtime.loader.load(entry, { signal: liveSignal() }),
      runtime.loader.load(entry, { signal: liveSignal() }),
    ])

    expect(aroundLoad).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('wraps a speculative preload the same way', async () => {
    const aroundLoad = vi.fn((load: () => Promise<unknown>) => load())
    const preload = vi.fn(async () => undefined)
    const { runtime } = create({
      adapters: [{ ...first, aroundLoad: aroundLoad as NonNullable<MfeAdapter['aroundLoad']> }],
      loader: { ...countingLoader({}).loader, preload },
      registryEntries: [published('reports', 'first')],
    })
    const entry = runtime.registry.entries.get('reports')
    if (!entry) throw new Error('expected reports in the registry')

    await runtime.loader.preload?.(entry, { signal: liveSignal() })

    expect(preload).toHaveBeenCalledTimes(1)
    expect(aroundLoad).toHaveBeenCalledTimes(1)
  })
})

describe('deadlines', () => {
  it('uses the defaults when the shell names none', () => {
    const { runtime } = create()

    expect(runtime.deadlines).toEqual(DEFAULT_DEADLINES)
  })

  it('merges the phases a shell tunes over the defaults', () => {
    const { runtime } = create({ deadlines: { load: 90_000 } })

    expect(runtime.deadlines).toEqual({ ...DEFAULT_DEADLINES, load: 90_000 })
  })
})

describe('developer overrides', () => {
  it('points an entry at the overridden manifest and lists it as active', () => {
    const local = 'http://localhost:3001/mf-manifest.json'
    const { runtime, activeOverrides } = create({
      registryEntries: [published('reports', 'first')],
      overrideStorage: overridesOf({ reports: local }),
    })

    expect(runtime.registry.entries.get('reports')?.manifestUrl).toBe(local)
    expect([...activeOverrides]).toEqual([['reports', local]])
  })

  it('warns about overrides it could not read rather than ignoring them', () => {
    create({ overrideStorage: overridesOf('{not json') })

    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      severity: 'warning',
      error: { code: 'registry/invalid-entry' },
    })
  })

  /** One container registers under one name, so two URLs for it cannot both apply. */
  it('warns when two definitions of one container are pointed at different URLs', () => {
    create({
      registryEntries: [
        published('alert-panel', 'first', { container: 'example_alerts' }),
        published('alert-feed', 'first', { container: 'example_alerts' }),
      ],
      overrideStorage: overridesOf({
        'alert-panel': 'http://localhost:3001/mf-manifest.json',
        'alert-feed': 'http://localhost:3002/mf-manifest.json',
      }),
    })

    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ severity: 'warning', error: { id: 'example_alerts' } })
  })
})

describe('the storage session', () => {
  it('adopts the generation it is given', () => {
    const { runtime } = create({ sessionGeneration: 'gen-given' })

    expect(runtime.storage.sessionGeneration).toBe('gen-given')
  })

  it('establishes one when none is given, from the generation it mints', () => {
    const mint = vi.fn(() => 'gen-minted')

    handle = createMfeRuntime({ ...baseOptions(), nextSessionGeneration: mint })
    const { runtime } = handle

    expect(runtime.storage.sessionGeneration).toBe('gen-minted')
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('retires the session with a freshly minted generation when the user changes', () => {
    const mint = vi.fn(() => 'gen-2')
    const { runtime } = create({ nextSessionGeneration: mint })

    runtime.shellState.apply({ user: { id: 'grace', name: 'Grace' } })

    expect(runtime.storage.sessionGeneration).toBe('gen-2')
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('retires the session when the groups change', () => {
    const { runtime } = create({ nextSessionGeneration: () => 'gen-2' })

    runtime.shellState.apply({ groups: ['ops', 'admins'] })

    expect(runtime.storage.sessionGeneration).toBe('gen-2')
  })

  it('keeps the session across a theme change', () => {
    const mint = vi.fn(() => 'gen-2')
    const { runtime } = create({ nextSessionGeneration: mint })

    runtime.shellState.apply({ theme: 'light' })

    expect(runtime.storage.sessionGeneration).toBe('gen-1')
    expect(mint).not.toHaveBeenCalled()
  })
})

describe('disposing the runtime', () => {
  it('stops retiring sessions and drops every blocker', () => {
    const mint = vi.fn(() => 'gen-2')
    const created = create({ nextSessionGeneration: mint })
    created.runtime.navigator.registerBlocker('reports#1', {
      depth: 1,
      shouldBlock: () => true,
      confirm: () => Promise.resolve('proceed'),
    })

    created.dispose()
    handle = null
    created.runtime.shellState.apply({ user: { id: 'grace', name: 'Grace' } })

    expect(mint).not.toHaveBeenCalled()
    expect(created.runtime.navigator.blockerCount).toBe(0)
  })

  it('clears a diagnostics hub it created', () => {
    const created = create()
    const error = createMfeError({
      code: 'mount/failure',
      id: 'reports',
      operation: 'mount App',
      repair: 'Retry.',
    })

    created.dispose()
    handle = null
    created.runtime.diagnostics.report(error)

    expect(recorded).toEqual([])
  })

  /** A hub the shell lent it keeps the shell's own sinks. */
  it('removes only the sinks it added to a hub it was lent', () => {
    const shellOwned: Diagnostic[] = []
    const diagnostics = new DiagnosticsHub([diagnostic => shellOwned.push(diagnostic)])
    const created = create({ diagnostics })
    const error = createMfeError({
      code: 'mount/failure',
      id: 'reports',
      operation: 'mount App',
      repair: 'Retry.',
    })

    created.dispose()
    handle = null
    diagnostics.report(error)

    expect(created.runtime.diagnostics).toBe(diagnostics)
    expect(shellOwned).toHaveLength(1)
    expect(recorded).toEqual([])
  })
})

describe('auditing action runs', () => {
  it('hands the host its record when the telemetry provider throws, and reports the provider', async () => {
    const auditAction = vi.fn()
    const created = create({
      auditAction,
      telemetryProvider: {
        ...createNoopTelemetryProvider(),
        isLevelEnabled: () => true,
        record: () => {
          throw new Error('collector down')
        },
      },
    })
    created.runtime.actions.registerHost({ name: 'refresh', label: 'Refresh', execute: () => 1 })

    const result = await created.runtime.actions.execute('@host:refresh', { caller: 'palette' })

    expect(result.status).toBe('executed')
    expect(auditAction).toHaveBeenCalledTimes(1)
    expect(auditAction.mock.calls[0]?.[0]).toMatchObject({
      actionId: '@host:refresh',
      outcome: 'executed',
    })
    expect(recorded.map(diagnostic => [diagnostic.severity, diagnostic.error.code])).toEqual([
      ['warning', 'config/invalid'],
    ])
  })
})
