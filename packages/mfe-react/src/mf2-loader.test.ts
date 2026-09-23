/**
 * The loader's isolation contract: an entry whose manifest cannot be fetched costs the page that
 * one surface, and every other definition still loads (§30).
 */

import { isMfeError, type RegistryEntry } from '@company/mfe-core'
import type { AnyRouter } from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget, type AppDefinition } from './definition.ts'
import { containerNameOf, createMf2ContainerLoader } from './mf2-loader.ts'
import type { ReactRegistryEntry } from './registry/react-adapter.ts'

/** What the federation runtime throws when it cannot fetch or parse a manifest. */
function manifestError(manifestUrl: string): Error {
  return new Error(
    '[ Federation Runtime ]: Failed to get manifest. #RUNTIME-003\n' +
      `args: {"manifestUrl":"${manifestUrl}"}\n` +
      'Original Error Message:\n TypeError: Failed to fetch',
  )
}

function appEntry(id: string, container: string, manifestUrl: string): ReactRegistryEntry {
  return { id, definitionKind: 'app', adapter: 'react', manifestUrl, container, expose: './app' }
}

function widgetEntry(id: string, container: string, manifestUrl: string): ReactRegistryEntry {
  return {
    id,
    definitionKind: 'widget',
    adapter: 'react',
    manifestUrl,
    container,
    expose: `./widgets/${id}`,
  }
}

const liveSignal = (): AbortSignal => new AbortController().signal

/** The loader never builds the router, so the factory only has to exist. */
function unusedRouter(): AnyRouter {
  throw new Error('the container loader never builds a router')
}

const anApp = (id: string): AppDefinition => createApp({ id, router: unusedRouter })

/** Containers named by their remote id, so one test can hold a reachable and a dead one. */
function createRuntime(containers: Readonly<Record<string, () => Promise<unknown>>>) {
  const registerRemotes = vi.fn()
  const loadRemote = vi.fn((id: string) => {
    const container = containers[id.split('/')[0] ?? '']
    if (!container) return Promise.reject(new Error(`no container serves ${id}`))
    return container()
  })

  return {
    registerRemotes,
    loadRemote,
    runtime: { registerRemotes, loadRemote: loadRemote as <T>(id: string) => Promise<T | null> },
  }
}

describe('createMf2ContainerLoader', () => {
  it('loads a definition from the container its registry entry names', async () => {
    const definition = anApp('operations')
    const { runtime, registerRemotes, loadRemote } = createRuntime({
      example_operations: () => Promise.resolve({ operations: definition }),
    })
    const loader = createMf2ContainerLoader({ runtime })

    const loaded = await loader.load(
      appEntry('operations', 'example_operations', 'http://localhost:3001/mf-manifest.json'),
      { signal: liveSignal() },
    )

    expect(registerRemotes).toHaveBeenCalledWith([
      { name: 'example_operations', entry: 'http://localhost:3001/mf-manifest.json' },
    ])
    expect(loadRemote).toHaveBeenCalledWith('example_operations/app')
    expect(loaded.module).toBe(definition)
  })

  /** Loading the reachable container after the unreachable one is the order failures spread in. */
  it('rejects only the definition whose manifest failed, and keeps the rest loadable', async () => {
    const dead = 'http://localhost:9999/mf-manifest.json'
    const reports = anApp('reports')
    const panel = createWidget({
      id: 'alert-panel',
      inputs: z.object({}),
      events: {},
      render: () => null,
    })

    const { runtime } = createRuntime({
      example_operations: () => Promise.reject(manifestError(dead)),
      example_reports: () => Promise.resolve({ reports }),
      example_alert_panel: () => Promise.resolve({ 'alert-panel': panel }),
    })
    const loader = createMf2ContainerLoader({ runtime })

    const thrown = await loader
      .load(appEntry('operations', 'example_operations', dead), { signal: liveSignal() })
      .catch((error: unknown) => error)

    expect(isMfeError(thrown)).toBe(true)
    expect(thrown).toMatchObject({ code: 'load/manifest-failure', id: 'operations' })
    expect((thrown as Error).message).toContain(dead)

    const afterwards = await loader.load(
      appEntry('reports', 'example_reports', 'http://localhost:3002/mf-manifest.json'),
      { signal: liveSignal() },
    )
    expect(afterwards.module).toBe(reports)

    const widget = await loader.load(
      widgetEntry('alert-panel', 'example_alert_panel', 'http://localhost:3003/mf-manifest.json'),
      { signal: liveSignal() },
    )
    expect(widget.module).toBe(panel)
  })

  it('lets a failed container be loaded again once it is reachable', async () => {
    const definition = anApp('operations')
    let reachable = false
    const { runtime } = createRuntime({
      example_operations: () =>
        reachable
          ? Promise.resolve({ operations: definition })
          : Promise.reject(manifestError('http://localhost:9999/mf-manifest.json')),
    })
    const loader = createMf2ContainerLoader({ runtime })
    const entry = appEntry(
      'operations',
      'example_operations',
      'http://localhost:9999/mf-manifest.json',
    )

    await expect(loader.load(entry, { signal: liveSignal() })).rejects.toThrow()
    reachable = true

    const loaded = await loader.load(entry, { signal: liveSignal() })
    expect(loaded.module).toBe(definition)
  })

  it('reports a chunk that failed after the manifest loaded as an entry failure', async () => {
    const { runtime } = createRuntime({
      example_operations: () => Promise.reject(new Error('Loading chunk 42 failed')),
    })
    const loader = createMf2ContainerLoader({ runtime })

    const thrown = await loader
      .load(
        appEntry('operations', 'example_operations', 'http://localhost:3001/mf-manifest.json'),
        {
          signal: liveSignal(),
        },
      )
      .catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'load/entry-failure', id: 'operations' })
  })
})

/** The runtime applies `reactAdapter.aroundLoad`; applying it here too would hide it twice. */
describe('the router global while a container evaluates', () => {
  const owner = globalThis as { __TSR_ROUTER__?: unknown }

  afterEach(() => {
    delete owner.__TSR_ROUTER__
  })

  it('is left to the adapter hook the runtime applies, rather than hidden here', async () => {
    const shellRouter = { id: 'shell' }
    owner.__TSR_ROUTER__ = shellRouter
    let seenDuringLoad: unknown
    const { runtime } = createRuntime({
      example_operations: () => {
        seenDuringLoad = owner.__TSR_ROUTER__
        return Promise.resolve({ operations: anApp('operations') })
      },
    })

    await createMf2ContainerLoader({ runtime }).load(
      appEntry('operations', 'example_operations', 'http://localhost:3001/mf-manifest.json'),
      { signal: liveSignal() },
    )

    expect(seenDuringLoad).toBe(shellRouter)
  })
})

describe('containerNameOf', () => {
  it('names the container of any adapter’s federated entry', () => {
    const angular: RegistryEntry & { readonly container: string } = {
      id: 'reports',
      definitionKind: 'app',
      adapter: 'angular',
      manifestUrl: 'http://localhost:4201/mf-manifest.json',
      container: 'example_reports',
    }

    expect(
      containerNameOf(appEntry('operations', 'example_operations', 'http://localhost:3001/m.json')),
    ).toBe('example_operations')
    expect(containerNameOf(angular)).toBe('example_reports')
  })

  it('names nothing for an entry that was not federated by a framework build', () => {
    expect(
      containerNameOf({
        id: 'billing',
        definitionKind: 'app',
        adapter: 'legacy-angular',
        manifestUrl: 'https://cdn.example.test/billing/manifest.json',
      }),
    ).toBeUndefined()
  })
})
