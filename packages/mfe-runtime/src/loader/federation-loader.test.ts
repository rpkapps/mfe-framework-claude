/**
 * The federation loader serves every adapter's containers, so it reads only what they share:
 * the entry's container name and the brand on what the container exports. An entry whose
 * manifest cannot be fetched costs the page that one surface, and every other definition still
 * loads (§30).
 */

import { describe, expect, it, vi } from 'vitest'

import {
  DEFINITION_BRAND,
  isMfeError,
  type BrandedDefinition,
  type DefinitionKind,
  type RegistryEntry,
} from '@company/mfe-core'

import {
  createFederationContainerLoader,
  federationTarget,
  isFederatedEntry,
  type FederatedRegistryEntry,
  type FederationRuntime,
} from './federation-loader.ts'

/** What the federation runtime throws when it cannot fetch or parse a manifest. */
function manifestError(manifestUrl: string): Error {
  return new Error(
    '[ Federation Runtime ]: Failed to get manifest. #RUNTIME-003\n' +
      `args: {"manifestUrl":"${manifestUrl}"}\n` +
      'Original Error Message:\n TypeError: Failed to fetch',
  )
}

function definition(
  id: string,
  kind: DefinitionKind = 'app',
  framework = 'angular',
): BrandedDefinition {
  return { [DEFINITION_BRAND]: true, kind, id, framework }
}

function entry(
  id: string,
  container: string,
  overrides: Partial<FederatedRegistryEntry> = {},
): FederatedRegistryEntry {
  return {
    id,
    definitionKind: 'app',
    adapter: 'angular',
    manifestUrl: `http://localhost:3001/${id}/mf-manifest.json`,
    container,
    ...overrides,
  }
}

const liveSignal = (): AbortSignal => new AbortController().signal

/** Containers named by their remote id, so one test can hold a reachable and a dead one. */
function createRuntime(containers: Readonly<Record<string, () => Promise<unknown>>>) {
  const registerRemotes = vi.fn()
  const loadRemote = vi.fn((id: string) => {
    const container = containers[id.split('/')[0] ?? '']
    if (!container) return Promise.reject(new Error(`no container serves ${id}`))
    return container()
  })

  const runtime: FederationRuntime = {
    registerRemotes,
    loadRemote: loadRemote as <T>(id: string) => Promise<T | null>,
  }
  return { registerRemotes, loadRemote, runtime }
}

describe('isFederatedEntry', () => {
  it('recognises any adapter’s entry that names a container', () => {
    expect(isFederatedEntry(entry('reports', 'example_reports'))).toBe(true)
    expect(isFederatedEntry(entry('reports', 'example_reports', { adapter: 'react' }))).toBe(true)
  })

  it('refuses an entry that names no container, or an empty one', () => {
    const unnamed: RegistryEntry = {
      id: 'billing',
      definitionKind: 'app',
      adapter: 'legacy-angular',
      manifestUrl: 'https://cdn.example.test/billing/manifest.json',
    }

    expect(isFederatedEntry(unnamed)).toBe(false)
    expect(isFederatedEntry(entry('reports', ''))).toBe(false)
  })
})

describe('federationTarget', () => {
  it('uses the expose path the build published', () => {
    expect(federationTarget(entry('reports', 'example_reports', { expose: './main' }))).toEqual({
      container: 'example_reports',
      expose: './main',
    })
  })

  it('falls back to the framework convention for each kind', () => {
    expect(federationTarget(entry('reports', 'example_reports')).expose).toBe('./app')
    expect(
      federationTarget(entry('alert-panel', 'example_alerts', { definitionKind: 'widget' })).expose,
    ).toBe('./widgets/alert-panel')
  })
})

describe('createFederationContainerLoader', () => {
  it('loads a definition from the container its registry entry names', async () => {
    const reports = definition('reports')
    const { runtime, registerRemotes, loadRemote } = createRuntime({
      example_reports: () => Promise.resolve({ reports }),
    })
    const loader = createFederationContainerLoader({ runtime })

    const loaded = await loader.load(entry('reports', 'example_reports'), { signal: liveSignal() })

    expect(registerRemotes).toHaveBeenCalledWith([
      { name: 'example_reports', entry: 'http://localhost:3001/reports/mf-manifest.json' },
    ])
    expect(loadRemote).toHaveBeenCalledWith('example_reports/app')
    expect(loaded.module).toBe(reports)
    expect(loaded.identity).toEqual({ id: 'reports', kind: 'app' })
  })

  it('reports the version the definition carries in its identity', async () => {
    const reports = { ...definition('reports'), version: '2.1.0' }
    const { runtime } = createRuntime({ example_reports: () => Promise.resolve({ reports }) })
    const loader = createFederationContainerLoader({ runtime })

    const loaded = await loader.load(entry('reports', 'example_reports'), { signal: liveSignal() })

    expect(loaded.identity).toEqual({ id: 'reports', kind: 'app', version: '2.1.0' })
  })

  it('registers a container once however many of its definitions load', async () => {
    const panel = definition('alert-panel', 'widget')
    const feed = definition('alert-feed', 'widget')
    const { runtime, registerRemotes, loadRemote } = createRuntime({
      example_alerts: () => Promise.resolve({ panel, feed }),
    })
    const loader = createFederationContainerLoader({ runtime })

    await loader.load(entry('alert-panel', 'example_alerts', { definitionKind: 'widget' }), {
      signal: liveSignal(),
    })
    await loader.load(entry('alert-feed', 'example_alerts', { definitionKind: 'widget' }), {
      signal: liveSignal(),
    })

    expect(registerRemotes).toHaveBeenCalledTimes(1)
    expect(loadRemote.mock.calls).toEqual([
      ['example_alerts/widgets/alert-panel'],
      ['example_alerts/widgets/alert-feed'],
    ])
  })

  it('loads a definition whichever adapter built it', async () => {
    const reports = definition('reports', 'app', 'react')
    const { runtime } = createRuntime({ example_reports: () => Promise.resolve({ reports }) })
    const loader = createFederationContainerLoader({ runtime })

    const loaded = await loader.load(entry('reports', 'example_reports', { adapter: 'react' }), {
      signal: liveSignal(),
    })

    expect(loaded.module).toBe(reports)
  })

  it('refuses an entry that names no federation container, before touching the runtime', async () => {
    const { runtime, registerRemotes, loadRemote } = createRuntime({})
    const loader = createFederationContainerLoader({ runtime })

    const thrown = await loader
      .load(
        {
          id: 'billing',
          definitionKind: 'app',
          adapter: 'legacy-angular',
          manifestUrl: 'https://cdn.example.test/billing/manifest.json',
        },
        { signal: liveSignal() },
      )
      .catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'registry/invalid-entry', id: 'billing' })
    expect((thrown as Error).message).toContain('legacy-angular')
    expect(registerRemotes).not.toHaveBeenCalled()
    expect(loadRemote).not.toHaveBeenCalled()
  })

  /** Loading the reachable container after the unreachable one is the order failures spread in. */
  it('rejects only the definition whose manifest failed, and keeps the rest loadable', async () => {
    const dead = 'http://localhost:9999/mf-manifest.json'
    const reports = definition('reports')
    const { runtime } = createRuntime({
      example_operations: () => Promise.reject(manifestError(dead)),
      example_reports: () => Promise.resolve({ reports }),
    })
    const loader = createFederationContainerLoader({ runtime })

    const thrown = await loader
      .load(entry('operations', 'example_operations', { manifestUrl: dead }), {
        signal: liveSignal(),
      })
      .catch((error: unknown) => error)

    expect(isMfeError(thrown)).toBe(true)
    expect(thrown).toMatchObject({ code: 'load/manifest-failure', id: 'operations' })
    expect((thrown as Error).message).toContain(dead)

    const afterwards = await loader.load(entry('reports', 'example_reports'), {
      signal: liveSignal(),
    })
    expect(afterwards.module).toBe(reports)
  })

  it('reports a container the runtime refused to register as a manifest failure', async () => {
    const { runtime, registerRemotes } = createRuntime({})
    registerRemotes.mockImplementation(() => {
      throw new Error('invalid remote entry')
    })
    const loader = createFederationContainerLoader({ runtime })

    const thrown = await loader
      .load(entry('reports', 'example_reports'), { signal: liveSignal() })
      .catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'load/manifest-failure', id: 'reports' })
  })

  it('lets a failed container be loaded again once it is reachable', async () => {
    const reports = definition('reports')
    let reachable = false
    const { runtime } = createRuntime({
      example_reports: () =>
        reachable
          ? Promise.resolve({ reports })
          : Promise.reject(manifestError('http://localhost:9999/mf-manifest.json')),
    })
    const loader = createFederationContainerLoader({ runtime })

    await expect(
      loader.load(entry('reports', 'example_reports'), { signal: liveSignal() }),
    ).rejects.toThrow()
    reachable = true

    const loaded = await loader.load(entry('reports', 'example_reports'), {
      signal: liveSignal(),
    })
    expect(loaded.module).toBe(reports)
  })

  it('reports a chunk that failed after the manifest loaded as an entry failure', async () => {
    const { runtime } = createRuntime({
      example_reports: () => Promise.reject(new Error('Loading chunk 42 failed')),
    })
    const loader = createFederationContainerLoader({ runtime })

    const thrown = await loader
      .load(entry('reports', 'example_reports'), { signal: liveSignal() })
      .catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'load/entry-failure', id: 'reports' })
  })

  it('refuses a definition of the other kind than its registry entry says', async () => {
    const { runtime } = createRuntime({
      example_reports: () => Promise.resolve({ reports: definition('reports', 'widget') }),
    })
    const loader = createFederationContainerLoader({ runtime })

    const thrown = await loader
      .load(entry('reports', 'example_reports'), { signal: liveSignal() })
      .catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'registry/invalid-entry', id: 'reports' })
    expect((thrown as Error).message).toContain('a widget definition')
  })

  it('does not start a load for a signal that is already aborted', async () => {
    const { runtime, registerRemotes } = createRuntime({})
    const loader = createFederationContainerLoader({ runtime })
    const controller = new AbortController()
    controller.abort()

    await expect(
      loader.load(entry('reports', 'example_reports'), { signal: controller.signal }),
    ).rejects.toThrow()
    expect(registerRemotes).not.toHaveBeenCalled()
  })

  it('discards a definition that arrives after its caller aborted', async () => {
    const controller = new AbortController()
    const { runtime } = createRuntime({
      example_reports: () => {
        controller.abort()
        return Promise.resolve({ reports: definition('reports') })
      },
    })
    const loader = createFederationContainerLoader({ runtime })

    await expect(
      loader.load(entry('reports', 'example_reports'), { signal: controller.signal }),
    ).rejects.toThrow()
  })
})

describe('the definition a federation entry exports', () => {
  async function loadFrom(moduleExports: unknown, id = 'reports'): Promise<unknown> {
    const { runtime } = createRuntime({ example_reports: () => Promise.resolve(moduleExports) })
    const loader = createFederationContainerLoader({ runtime })
    return await loader
      .load(entry(id, 'example_reports'), { signal: liveSignal() })
      .then(loaded => loaded.module)
      .catch((error: unknown) => error)
  }

  it('may be the module itself', async () => {
    const reports = definition('reports')

    expect(await loadFrom(reports)).toBe(reports)
  })

  it('is the one whose id the entry names, when the module exports several', async () => {
    const reports = definition('reports')

    expect(await loadFrom({ other: definition('other'), reports })).toBe(reports)
  })

  it('is the only one, whatever it is called', async () => {
    const renamed = definition('reports-v2')

    expect(await loadFrom({ default: renamed })).toBe(renamed)
  })

  it('cannot be chosen among several when none has the entry’s id', async () => {
    const thrown = await loadFrom({ first: definition('first'), second: definition('second') })

    expect(thrown).toMatchObject({ code: 'load/entry-failure', id: 'reports' })
    expect((thrown as Error).message).toContain('first, second')
  })

  it('must carry the brand and name an adapter', async () => {
    const unbranded = { kind: 'app', id: 'reports', framework: 'angular' }
    const nameless = { [DEFINITION_BRAND]: true, kind: 'app', id: 'reports' }

    expect(await loadFrom({ unbranded })).toMatchObject({ code: 'load/entry-failure' })
    expect(await loadFrom(nameless)).toMatchObject({ code: 'load/entry-failure' })
  })

  it('names what arrived instead when the module holds nothing usable', async () => {
    const thrown = await loadFrom(null)

    expect(thrown).toMatchObject({ code: 'load/entry-failure', id: 'reports' })
    expect((thrown as Error).message).toContain('null')
  })
})
