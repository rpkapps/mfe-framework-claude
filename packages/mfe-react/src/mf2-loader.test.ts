/**
 * The loader's isolation contract.
 *
 * A registry is assembled from descriptors produced by builds the host does not
 * control, so an entry whose manifest cannot be fetched is normal rather than
 * exceptional. What the framework promises is that such an entry costs the page
 * that one surface: the boundary showing it takes a `load/manifest-failure`,
 * and every other definition — including one from the same page and one loaded
 * afterwards — still loads.
 */

import { isMfeError, type NeutralRegistryEntry } from '@company/mfe-core'
import type { AnyRouter } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget, type AppDefinition } from './definition.ts'
import { createMf2ContainerLoader } from './mf2-loader.ts'

/** What the federation runtime throws when it cannot fetch or parse a manifest. */
function manifestError(manifestUrl: string): Error {
  return new Error(
    '[ Federation Runtime ]: Failed to get manifest. #RUNTIME-003\n' +
      `args: {"manifestUrl":"${manifestUrl}"}\n` +
      'Original Error Message:\n TypeError: Failed to fetch',
  )
}

function appEntry(id: string, containerName: string, manifestUrl: string): NeutralRegistryEntry {
  return {
    id,
    definitionKind: 'app',
    adapter: 'react',
    manifestUrl,
    adapterData: { containerName, exposeName: './app' },
  }
}

const liveSignal = (): AbortSignal => new AbortController().signal

/**
 * The loader hands a definition back; it never builds the router, so the
 * factory only has to exist. Throwing says so rather than pretending.
 */
function unusedRouter(): AnyRouter {
  throw new Error('the container loader never builds a router')
}

const anApp = (id: string): AppDefinition => createApp({ id, router: unusedRouter })

/**
 * A runtime whose containers are named by their remote id, so one test can hold
 * a reachable container and an unreachable one at the same time.
 */
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
  it('loads a definition from the container its descriptor names', async () => {
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

  /**
   * The defect this pins: a manifest that would not load took the whole page
   * down rather than its own surface. Loading the reachable container *after*
   * the unreachable one is the half that matters — that is the order in which
   * the failure used to spread, because the host's share resolution waited on
   * every remote it had been told about.
   */
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
      {
        id: 'alert-panel',
        definitionKind: 'widget',
        adapter: 'react',
        manifestUrl: 'http://localhost:3003/mf-manifest.json',
        adapterData: { containerName: 'example_alert_panel', exposeName: './widgets/alert-panel' },
      },
      { signal: liveSignal() },
    )
    expect(widget.module).toBe(panel)
  })

  /** A retry has to reach the runtime again rather than replay the failure. */
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

  /**
   * A container that answered and then could not serve a chunk is a different
   * repair — the network panel, not the manifest URL — so the two failures keep
   * their own codes.
   */
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
