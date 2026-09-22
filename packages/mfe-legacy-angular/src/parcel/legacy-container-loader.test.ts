import { describe, expect, it, vi } from 'vitest'

import { isMfeError, type RegistryEntry } from '@company/mfe-core'

import { legacyAngularAdapter } from '../registry/legacy-adapter.ts'
import {
  createLegacyContainerLoader,
  type LegacyFederationRuntime,
} from './legacy-container-loader.ts'
import type { LegacyParcelConfig } from './single-spa-contract.ts'

function legacyRegistryEntry(overrides: Record<string, unknown> = {}): RegistryEntry {
  return legacyAngularAdapter.parse({
    name: 'asset-tracker',
    mfManifestUrl: 'https://cdn.example.test/asset-tracker/mf-manifest.json',
    version: '4.7.1',
    routes: ['/asset-tracker'],
    ...overrides,
  })
}

/** What a legacy container exposes under `./single-spa-app`. */
function parcelConfig(): LegacyParcelConfig {
  return {
    bootstrap: [() => Promise.resolve()],
    mount: [() => Promise.resolve()],
    unmount: [() => Promise.resolve()],
  }
}

function createRuntime(
  loadRemote: (id: string) => Promise<unknown>,
  registerRemotes: LegacyFederationRuntime['registerRemotes'] = () => undefined,
): {
  readonly runtime: LegacyFederationRuntime
  readonly registerRemotes: ReturnType<typeof vi.fn>
  readonly loadRemote: ReturnType<typeof vi.fn>
} {
  const registerSpy = vi.fn(registerRemotes)
  const loadSpy = vi.fn(loadRemote)
  return {
    runtime: {
      registerRemotes: registerSpy,
      loadRemote: loadSpy as LegacyFederationRuntime['loadRemote'],
    },
    registerRemotes: registerSpy,
    loadRemote: loadSpy,
  }
}

const liveSignal = (): AbortSignal => new AbortController().signal

describe('createLegacyContainerLoader', () => {
  it('registers the remote under the legacy name and loads its single-spa parcel', async () => {
    const config = parcelConfig()
    const { runtime, registerRemotes, loadRemote } = createRuntime(() => Promise.resolve(config))
    const loader = createLegacyContainerLoader({ runtime })

    const loaded = await loader.load(legacyRegistryEntry(), { signal: liveSignal() })

    expect(registerRemotes).toHaveBeenCalledWith([
      { name: 'asset-tracker', entry: 'https://cdn.example.test/asset-tracker/mf-manifest.json' },
    ])
    expect(loadRemote).toHaveBeenCalledWith('asset-tracker/single-spa-app')
    expect(loaded.module.parcelConfig).toBe(config)
  })

  it('returns the identity and the shell-owned navigation the parcel mount needs', async () => {
    const { runtime } = createRuntime(() => Promise.resolve(parcelConfig()))
    const loader = createLegacyContainerLoader({ runtime })

    const loaded = await loader.load(legacyRegistryEntry(), { signal: liveSignal() })

    expect(loaded.identity).toEqual({ id: 'asset-tracker', kind: 'app', version: '4.7.1' })
    expect(loaded.module.containerName).toBe('asset-tracker')
    expect(loaded.module.navigationOwnership).toBe('shell')
  })

  it('registers a container once even when it is loaded repeatedly', async () => {
    const { runtime, registerRemotes } = createRuntime(() => Promise.resolve(parcelConfig()))
    const loader = createLegacyContainerLoader({ runtime })
    const entry = legacyRegistryEntry()

    await loader.load(entry, { signal: liveSignal() })
    await loader.load(entry, { signal: liveSignal() })

    expect(registerRemotes).toHaveBeenCalledTimes(1)
  })

  it('accepts lifecycles exported behind a default export', async () => {
    const config = parcelConfig()
    const { runtime } = createRuntime(() => Promise.resolve({ default: config }))
    const loader = createLegacyContainerLoader({ runtime })

    const loaded = await loader.load(legacyRegistryEntry(), { signal: liveSignal() })

    expect(loaded.module.parcelConfig).toBe(config)
  })

  it('does no work when the caller already gave up', async () => {
    const { runtime, registerRemotes, loadRemote } = createRuntime(() =>
      Promise.resolve(parcelConfig()),
    )
    const loader = createLegacyContainerLoader({ runtime })
    const controller = new AbortController()
    controller.abort()

    await expect(
      loader.load(legacyRegistryEntry(), { signal: controller.signal }),
    ).rejects.toThrow()
    expect(registerRemotes).not.toHaveBeenCalled()
    expect(loadRemote).not.toHaveBeenCalled()
  })
})

describe('createLegacyContainerLoader failures', () => {
  it('reports a registration failure against the manifest URL', async () => {
    const { runtime } = createRuntime(
      () => Promise.resolve(parcelConfig()),
      () => {
        throw new Error('manifest is not valid JSON')
      },
    )
    const loader = createLegacyContainerLoader({ runtime })

    const thrown = await loader
      .load(legacyRegistryEntry(), { signal: liveSignal() })
      .catch((error: unknown) => error)

    expect(isMfeError(thrown)).toBe(true)
    expect(thrown).toMatchObject({ code: 'load/manifest-failure', id: 'asset-tracker' })
    expect((thrown as Error).message).toContain(
      'https://cdn.example.test/asset-tracker/mf-manifest.json',
    )
  })

  it('reports a failed remote load against the unchanged legacy expose path', async () => {
    const { runtime } = createRuntime(() => Promise.reject(new Error('chunk 404')))
    const loader = createLegacyContainerLoader({ runtime })

    const thrown = await loader
      .load(legacyRegistryEntry(), { signal: liveSignal() })
      .catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'load/entry-failure' })
    expect((thrown as Error).message).toContain('asset-tracker/single-spa-app')
    expect((thrown as Error).message).toContain('chunk 404')
  })

  it('names the lifecycles a module is missing', async () => {
    const { runtime } = createRuntime(() => Promise.resolve({ mount: () => Promise.resolve() }))
    const loader = createLegacyContainerLoader({ runtime })

    const thrown = await loader
      .load(legacyRegistryEntry(), { signal: liveSignal() })
      .catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'load/entry-failure' })
    expect((thrown as Error).message).toContain('a module missing bootstrap, unmount')
  })

  it('reports a container that resolved nothing at all', async () => {
    const { runtime } = createRuntime(() => Promise.resolve(null))
    const loader = createLegacyContainerLoader({ runtime })

    const thrown = await loader
      .load(legacyRegistryEntry(), { signal: liveSignal() })
      .catch((error: unknown) => error)

    expect((thrown as Error).message).toContain('received nothing')
  })

  it('refuses an entry that is not a legacy entry at all', async () => {
    const { runtime } = createRuntime(() => Promise.resolve(parcelConfig()))
    const loader = createLegacyContainerLoader({ runtime })
    const reactEntry: RegistryEntry = {
      id: 'reports',
      definitionKind: 'app',
      adapter: 'react',
      manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
    }

    await expect(loader.load(reactEntry, { signal: liveSignal() })).rejects.toThrow(
      /an entry the legacy adapter parsed/,
    )
  })
})
