/**
 * The Angular adapter against the entries an Angular container's build publishes: it recognises
 * exactly the entries naming Angular, however broken the rest is, and `parse` is strict. With page
 * assets, every Angular load waits for them, and the page loads them once.
 */

import { isMfeError, type MfeError, type RegistryEntry } from '@company/mfe-core'
import { describe, expect, it, vi } from 'vitest'

import {
  angularAdapter,
  createAngularAdapter,
  type AngularAdapter,
  type AngularRegistryEntry,
} from './angular-adapter.ts'

/** A registry entry as the build plugin emits it for an Angular container. */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'reports',
    kind: 'app',
    mfe: { contractMajor: 1, framework: 'angular' },
    manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
    container: 'example_reports',
    ...overrides,
  }
}

function rejection(source: unknown): MfeError {
  try {
    angularAdapter.parse(source)
  } catch (error) {
    if (isMfeError(error)) return error
    throw error
  }
  throw new Error('expected the adapter to reject the entry')
}

describe('detect', () => {
  it('recognises an entry whose marker names Angular, however broken the rest of it is', () => {
    expect(angularAdapter.detect(entry())).toBe(true)
    expect(angularAdapter.detect(entry({ container: 7, mfe: { framework: 'angular' } }))).toBe(true)
  })

  it('leaves an entry naming another framework, or no framework at all, to another adapter', () => {
    expect(angularAdapter.detect(entry({ mfe: { contractMajor: 1, framework: 'other' } }))).toBe(
      false,
    )
    expect(angularAdapter.detect(entry({ mfe: { contractMajor: 1 } }))).toBe(false)
    expect(angularAdapter.detect(entry({ mfe: 'angular' }))).toBe(false)
  })

  it('is total over input that is not an entry at all', () => {
    for (const raw of [null, undefined, 'reports', 7, []]) {
      expect(angularAdapter.detect(raw)).toBe(false)
    }
  })
})

describe('parse', () => {
  it('reads an App entry, stamping this adapter on it', () => {
    const parsed = angularAdapter.parse(entry({ version: '1.2.0', expose: './app' }))

    expect(parsed).toEqual({
      id: 'reports',
      definitionKind: 'app',
      adapter: 'angular',
      manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
      container: 'example_reports',
      expose: './app',
      version: '1.2.0',
    })
  })

  it('reads a Widget’s published contract, capabilities and presentation', () => {
    const acknowledgedOnly = { type: 'object', properties: { acknowledged: {} } }
    const widget = angularAdapter.parse(
      entry({
        id: 'alert-panel',
        kind: 'widget',
        contract: { events: acknowledgedOnly, inputs: { type: 'object' } },
        title: 'Alert panel',
        tags: ['ops', 3, ''],
        icon: 'AP',
        hidden: true,
        build: { hash: 'abc123', time: { at: 'noon' } },
      }),
    )
    const app = angularAdapter.parse(
      entry({ capabilities: [{ name: 'settings', label: 'Settings', path: '/settings' }] }),
    )

    expect(widget).toMatchObject({
      definitionKind: 'widget',
      contract: { events: acknowledgedOnly, inputs: { type: 'object' } },
      title: 'Alert panel',
      tags: ['ops'],
      icon: 'AP',
      hidden: true,
      build: { hash: 'abc123' },
    })
    expect(app.capabilities).toEqual([{ name: 'settings', label: 'Settings', path: '/settings' }])
  })

  it('names the field that broke and the one repair', () => {
    const error = rejection(entry({ container: '' }))

    expect(error.code).toBe('registry/invalid-entry')
    expect(error.path).toEqual(['container'])
    expect(error.message).toContain('a non-empty federation container name')
    expect(error.message).toContain('Rebuild the container')
  })

  it('refuses a Widget contract on an App', () => {
    expect(rejection(entry({ contract: {} })).message).toContain('no Widget contract on an App')
  })

  it('gates a contract major the shell cannot load before reading the shape', () => {
    const error = rejection(
      entry({ mfe: { contractMajor: 2, framework: 'angular' }, container: 1 }),
    )

    expect(error.code).toBe('contract/unsupported-major')
    expect(error.message).toContain('Upgrade the shell')
  })
})

describe('is', () => {
  it('narrows only the entries this adapter parsed', () => {
    const parsed: RegistryEntry = angularAdapter.parse(entry())
    const other: RegistryEntry = { ...parsed, adapter: 'other' }

    expect(angularAdapter.is(parsed)).toBe(true)
    expect(angularAdapter.is(other)).toBe(false)
    if (angularAdapter.is(parsed)) {
      const narrowed: AngularRegistryEntry = parsed
      expect(narrowed.container).toBe('example_reports')
    }
  })
})

/** A promise settled from outside, so a test decides which of two loads finishes first. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

/** The runtime calls the hook with the entry the adapter parsed. */
function aroundLoadOf(adapter: AngularAdapter): NonNullable<AngularAdapter['aroundLoad']> {
  const aroundLoad = adapter.aroundLoad
  if (aroundLoad === undefined) throw new Error('expected the adapter to wrap its loads')
  return aroundLoad.bind(adapter)
}

/** Lets every settled promise run its reactions, so a test can observe what is still pending. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('page assets', () => {
  it('leaves loads unwrapped when the host names none', () => {
    expect(angularAdapter.aroundLoad).toBeUndefined()
    expect(createAngularAdapter().aroundLoad).toBeUndefined()
  })

  it('starts the container load without waiting for them, and mounts nothing before they settle', async () => {
    const assets = deferred<void>()
    const aroundLoad = aroundLoadOf(createAngularAdapter({ pageAssets: () => assets.promise }))
    const load = vi.fn(() => Promise.resolve('module'))

    let loaded: unknown = 'pending'
    const loading = aroundLoad(load, angularAdapter.parse(entry())).then(module => {
      loaded = module
    })
    await settle()

    expect(load).toHaveBeenCalledTimes(1)
    expect(loaded).toBe('pending')

    assets.resolve()
    await loading

    expect(loaded).toBe('module')
  })

  it('loads them once for every Angular load on the page, however many overlap', async () => {
    const assets = deferred<void>()
    const pageAssets = vi.fn(() => assets.promise)
    const aroundLoad = aroundLoadOf(createAngularAdapter({ pageAssets }))
    const reports = angularAdapter.parse(entry())
    const alerts = angularAdapter.parse(entry({ id: 'alert-panel', container: 'example_alerts' }))

    const first = aroundLoad(() => Promise.resolve('reports'), reports)
    const second = aroundLoad(() => Promise.resolve('alerts'), alerts)
    assets.resolve()

    await expect(Promise.all([first, second])).resolves.toEqual(['reports', 'alerts'])
    await expect(aroundLoad(() => Promise.resolve('later'), reports)).resolves.toBe('later')
    expect(pageAssets).toHaveBeenCalledTimes(1)
  })

  it('fails the waiting load with the definition it was for, and loads them again next time', async () => {
    const pageAssets = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('angular.css responded 503'))
      .mockResolvedValue(undefined)
    const aroundLoad = aroundLoadOf(createAngularAdapter({ pageAssets }))
    const reports = angularAdapter.parse(entry({ version: '1.2.0' }))

    const failure = await aroundLoad(() => Promise.resolve('module'), reports).catch(
      (error: unknown) => error,
    )

    expect(isMfeError(failure)).toBe(true)
    expect(failure).toMatchObject({ code: 'load/entry-failure', id: 'reports' })
    expect((failure as MfeError).message).toBe(
      "reports@1.2.0 failed to load the page assets every Angular container relies on: angular.css responded 503. Check that the host's Angular page assets are reachable; the next attempt loads them again.",
    )

    await expect(aroundLoad(() => Promise.resolve('module'), reports)).resolves.toBe('module')
    expect(pageAssets).toHaveBeenCalledTimes(2)
  })

  it('treats a page-assets function that throws like one that rejects', async () => {
    const aroundLoad = aroundLoadOf(
      createAngularAdapter({
        pageAssets: () => {
          throw new Error('no stylesheet')
        },
      }),
    )

    await expect(
      aroundLoad(() => Promise.resolve('module'), angularAdapter.parse(entry())),
    ).rejects.toMatchObject({ code: 'load/entry-failure', id: 'reports' })
  })

  it('reports a failed container load as the load failed, without waiting for the assets', async () => {
    const assets = deferred<void>()
    const aroundLoad = aroundLoadOf(createAngularAdapter({ pageAssets: () => assets.promise }))
    const unreachable = new Error('remoteEntry.js responded 404')

    await expect(
      aroundLoad(() => Promise.reject(unreachable), angularAdapter.parse(entry())),
    ).rejects.toBe(unreachable)
  })
})
