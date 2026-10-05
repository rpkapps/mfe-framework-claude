/**
 * The real federation runtime owns caches outside SharedContainerLoader. Intercept only its
 * network/entry hooks: registration, manifest caching, remote-entry caching and module loading
 * still execute in the installed runtime. These tests keep MF out of the neutral packages.
 */
import {
  createFederationContainerLoader,
  SharedContainerLoader,
  type FederatedRegistryEntry,
  type FederationRuntime,
} from '@company/mfe-react/host'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This integration test exercises MF-owned caches through its real runtime.
import {
  createInstance,
  type ModuleFederationRuntimePlugin,
} from '@module-federation/enhanced/runtime'
import { describe, expect, it, vi } from 'vitest'

import { counter } from './fixtures/counter.ts'

let serial = 0
const liveSignal = (): AbortSignal => new AbortController().signal

function realRuntime(plugin: ModuleFederationRuntimePlugin) {
  const name = `recovery_${++serial}`
  const runtime = createInstance({ name: `shell_${name}`, remotes: [], plugins: [plugin] })
  const registerRemotes = vi.fn<FederationRuntime['registerRemotes']>((remotes, options) => {
    runtime.registerRemotes([...remotes], options)
  })
  return {
    name,
    runtime,
    loader: createFederationContainerLoader({
      runtime: { registerRemotes, loadRemote: id => runtime.loadRemote(id) },
    }),
    registerRemotes,
  }
}

function entry(name: string, withManifest = false): FederatedRegistryEntry {
  return {
    id: 'counter',
    definitionKind: 'widget',
    adapter: 'react',
    requiresRuntime: '>=1.1.0 <2.0.0',
    container: name,
    manifestUrl: `https://edge.example.test/${name}/${withManifest ? 'mf-manifest.json' : 'remoteEntry.js'}`,
  }
}

const exportsForCounter = {
  init: () => undefined,
  get: () => async () => ({ counter }),
}

function manifest(name: string): object {
  return {
    id: name,
    name,
    metaData: {
      name,
      globalName: name,
      type: 'app',
      buildInfo: { buildVersion: '1.0.0', buildName: name },
      remoteEntry: { name: 'remoteEntry.js', path: '', type: 'var' },
      publicPath: `https://edge.example.test/${name}/`,
    },
    shared: [],
    remotes: [],
    exposes: [],
  }
}

describe('real Module Federation recovery', () => {
  it('retries a rejected manifest through the real manifest cache', async () => {
    // The federation runtime warns of the manifest it failed to get before the loader rejects; the
    // warning is captured and checked rather than printed.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let remoteName = ''
    const fetchManifest = vi
      .fn<NonNullable<ModuleFederationRuntimePlugin['fetch']>>()
      .mockRejectedValueOnce(new TypeError('Edge node is temporarily unavailable'))
      .mockImplementation(async () => new Response(JSON.stringify(manifest(remoteName))))
    const loadEntry = vi
      .fn<NonNullable<ModuleFederationRuntimePlugin['loadEntry']>>()
      .mockResolvedValue(exportsForCounter)
    const real = realRuntime({ name: 'recover-manifest', fetch: fetchManifest, loadEntry })
    remoteName = real.name
    const shared = new SharedContainerLoader(real.loader)
    const registryEntry = entry(real.name, true)

    await expect(shared.load(registryEntry, { signal: liveSignal() })).rejects.toMatchObject({
      code: 'load/manifest-failure',
    })
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(
      '[ Federation Runtime ]',
      expect.objectContaining({ message: expect.stringContaining('#RUNTIME-003') }),
    )
    warn.mockRestore()
    await expect(shared.load(registryEntry, { signal: liveSignal() })).resolves.toMatchObject({
      identity: { id: 'counter' },
      module: counter,
    })
    expect(fetchManifest).toHaveBeenCalledTimes(2)
    expect(loadEntry).toHaveBeenCalledTimes(1)
    expect(real.registerRemotes).toHaveBeenCalledTimes(1)
  })

  it('expires a hung remote entry and offers reload without force-resetting federation', async () => {
    let finishEntry: ((value: typeof exportsForCounter) => void) | undefined
    let reportStarted: (() => void) | undefined
    const started = new Promise<void>(resolve => {
      reportStarted = resolve
    })
    const loadEntry = vi.fn<NonNullable<ModuleFederationRuntimePlugin['loadEntry']>>(() => {
      reportStarted?.()
      return new Promise<typeof exportsForCounter>(resolve => {
        finishEntry = resolve
      })
    })
    const real = realRuntime({ name: 'hang-entry', loadEntry })
    const shared = new SharedContainerLoader(real.loader, { deadlineMs: 100 })
    const registryEntry = entry(real.name)
    const expired = shared.load(registryEntry, { signal: liveSignal() })
    const failure = expect(expired).rejects.toMatchObject({ code: 'load/timeout' })
    await started
    await failure
    expect(shared.inFlightCount).toBe(0)

    // Even a direct second call joins MF's existing remote-entry promise.
    const cachedAttempt = real.runtime.loadRemote(`${real.name}/widgets/counter`)
    await expect(shared.load(registryEntry, { signal: liveSignal() })).rejects.toMatchObject({
      code: 'load/reload-required',
    })
    expect(loadEntry).toHaveBeenCalledTimes(1)
    expect(real.registerRemotes).toHaveBeenCalledTimes(1)
    expect(real.registerRemotes.mock.calls[0]?.[1]).toBeUndefined()

    finishEntry?.(exportsForCounter)
    await expect(cachedAttempt).resolves.toEqual({ counter })
    // Late completion does not republish the aborted definition into our cache.
    await expect(shared.load(registryEntry, { signal: liveSignal() })).rejects.toMatchObject({
      code: 'load/reload-required',
    })
  })

  it('recognizes the real runtime retaining a rejected remote-entry promise', async () => {
    const loadEntry = vi
      .fn<NonNullable<ModuleFederationRuntimePlugin['loadEntry']>>()
      .mockRejectedValueOnce(new Error('Remote entry failed #RUNTIME-008'))
      .mockResolvedValue(exportsForCounter)
    const real = realRuntime({ name: 'reject-entry', loadEntry })
    const shared = new SharedContainerLoader(real.loader)
    const registryEntry = entry(real.name)
    await expect(shared.load(registryEntry, { signal: liveSignal() })).rejects.toMatchObject({
      code: 'load/reload-required',
    })
    await expect(real.runtime.loadRemote(`${real.name}/widgets/counter`)).rejects.toThrow(
      /#RUNTIME-008/,
    )
    await expect(shared.load(registryEntry, { signal: liveSignal() })).rejects.toThrow(
      /Save your work, then reload/,
    )
    expect(loadEntry).toHaveBeenCalledTimes(1)
    expect(real.registerRemotes).toHaveBeenCalledTimes(1)
  })
})
