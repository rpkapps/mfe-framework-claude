import { describe, expect, it, vi } from 'vitest'

import { isMfeError, type NeutralRegistryEntry } from '@company/mfe-core'

import {
  createInProcessLoader,
  SharedContainerLoader,
  type ContainerLoader,
  type LoadedDefinition,
} from './container-loader.ts'

interface TestModule {
  readonly name: string
}

function entryFor(id: string): NeutralRegistryEntry {
  return {
    id,
    definitionKind: 'app',
    adapter: 'react',
    manifestUrl: `https://cdn.example.test/${id}/mf-manifest.json`,
  }
}

function loadedFor(id: string): LoadedDefinition<TestModule> {
  return { identity: { id, kind: 'app' }, module: { name: id } }
}

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

/** An inner loader whose settlement the test controls, one deferred per call. */
function createControllableLoader(): {
  readonly loader: ContainerLoader<TestModule>
  readonly load: ReturnType<typeof vi.fn>
  readonly pending: Deferred<LoadedDefinition<TestModule>>[]
  readonly signals: AbortSignal[]
} {
  const pending: Deferred<LoadedDefinition<TestModule>>[] = []
  const signals: AbortSignal[] = []
  const load = vi.fn(
    (
      _entry: NeutralRegistryEntry,
      options: { readonly signal: AbortSignal },
    ): Promise<LoadedDefinition<TestModule>> => {
      signals.push(options.signal)
      const next = deferred<LoadedDefinition<TestModule>>()
      pending.push(next)
      return next.promise
    },
  )
  return { loader: { load }, load, pending, signals }
}

function settle<T>(deferredValue: Deferred<T> | undefined, value: T): void {
  if (!deferredValue) throw new Error('expected a pending load to settle')
  deferredValue.resolve(value)
}

describe('createInProcessLoader', () => {
  it('resolves a registered definition with no bundler, manifest or network', async () => {
    const reports = loadedFor('reports')
    const loader = createInProcessLoader(new Map([['reports', reports]]))

    const loaded = await loader.load(entryFor('reports'), {
      signal: new AbortController().signal,
    })

    expect(loaded).toBe(reports)
  })

  it('names the definitions it does know when one is not registered', async () => {
    const loader = createInProcessLoader(
      new Map([
        ['reports', loadedFor('reports')],
        ['operations', loadedFor('operations')],
      ]),
    )

    const failure = loader.load(entryFor('billing'), { signal: new AbortController().signal })

    await expect(failure).rejects.toMatchObject({ code: 'load/entry-failure', id: 'billing' })
    await failure.catch((error: unknown) => {
      expect(isMfeError(error)).toBe(true)
      expect((error as Error).message).toContain('a definition registered under "billing"')
      expect((error as Error).message).toContain('only reports, operations')
      expect((error as Error).message).toContain(
        'Register the definition with the test environment',
      )
    })
  })

  it('says the loader is empty rather than listing nothing', async () => {
    const loader = createInProcessLoader(new Map<string, LoadedDefinition<TestModule>>())

    await expect(
      loader.load(entryFor('reports'), { signal: new AbortController().signal }),
    ).rejects.toThrow(/an empty loader/)
  })

  it('refuses to start when the caller has already given up', async () => {
    const loader = createInProcessLoader(new Map([['reports', loadedFor('reports')]]))
    const controller = new AbortController()
    controller.abort()

    await expect(loader.load(entryFor('reports'), { signal: controller.signal })).rejects.toThrow()
  })
})

describe('SharedContainerLoader deduplication', () => {
  it('runs the inner loader once for several concurrent callers', async () => {
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader)
    const entry = entryFor('reports')

    const waiters = [
      shared.load(entry, { signal: new AbortController().signal }),
      shared.load(entry, { signal: new AbortController().signal }),
      shared.load(entry, { signal: new AbortController().signal }),
    ]
    expect(shared.inFlightCount).toBe(1)
    const loaded = loadedFor('reports')
    settle(inner.pending[0], loaded)

    await expect(Promise.all(waiters)).resolves.toEqual([loaded, loaded, loaded])
    expect(inner.load).toHaveBeenCalledTimes(1)
  })

  it('serves a later caller from the cache instead of loading again', async () => {
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader)
    const entry = entryFor('reports')
    const first = shared.load(entry, { signal: new AbortController().signal })
    const loaded = loadedFor('reports')
    settle(inner.pending[0], loaded)
    await first

    const second = await shared.load(entry, { signal: new AbortController().signal })

    expect(second).toBe(loaded)
    expect(inner.load).toHaveBeenCalledTimes(1)
    expect(shared.inFlightCount).toBe(0)
  })

  it('keeps separate containers separate', async () => {
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader)

    const reports = shared.load(entryFor('reports'), { signal: new AbortController().signal })
    const billing = shared.load(entryFor('billing'), { signal: new AbortController().signal })
    expect(shared.inFlightCount).toBe(2)
    settle(inner.pending[0], loadedFor('reports'))
    settle(inner.pending[1], loadedFor('billing'))

    await expect(reports).resolves.toMatchObject({ identity: { id: 'reports' } })
    await expect(billing).resolves.toMatchObject({ identity: { id: 'billing' } })
    expect(inner.load).toHaveBeenCalledTimes(2)
  })

  it('reloads after a failure instead of caching the rejection', async () => {
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader)
    const entry = entryFor('reports')

    const first = shared.load(entry, { signal: new AbortController().signal })
    inner.pending[0]?.reject(new Error('network down'))
    await expect(first).rejects.toThrow('network down')

    const second = shared.load(entry, { signal: new AbortController().signal })
    const loaded = loadedFor('reports')
    settle(inner.pending[1], loaded)

    await expect(second).resolves.toBe(loaded)
    expect(inner.load).toHaveBeenCalledTimes(2)
  })

  it('loads again after the module cache is cleared', async () => {
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader)
    const entry = entryFor('reports')
    const first = shared.load(entry, { signal: new AbortController().signal })
    settle(inner.pending[0], loadedFor('reports'))
    await first

    shared.clearCache()
    const second = shared.load(entry, { signal: new AbortController().signal })
    settle(inner.pending[1], loadedFor('reports'))
    await second

    expect(inner.load).toHaveBeenCalledTimes(2)
  })
})

describe('abandoning a shared load', () => {
  it('does not cancel work another caller still needs', async () => {
    // two mounts want the same container.
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader)
    const entry = entryFor('reports')
    const abandoning = new AbortController()
    const waiting = new AbortController()
    const abandoned = shared.load(entry, { signal: abandoning.signal })
    const stillWaiting = shared.load(entry, { signal: waiting.signal })

    // the first mount is disposed mid-load.
    abandoning.abort()

    // it gives up, the other caller is unaffected.
    await expect(abandoned).rejects.toMatchObject({ code: 'load/entry-failure', id: 'reports' })
    const loaded = loadedFor('reports')
    settle(inner.pending[0], loaded)
    await expect(stillWaiting).resolves.toBe(loaded)
    expect(inner.load).toHaveBeenCalledTimes(1)
  })

  it('never hands a caller’s own signal to the shared work', async () => {
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader)
    const abandoning = new AbortController()
    const abandoned = shared.load(entryFor('reports'), { signal: abandoning.signal })

    abandoning.abort()
    await expect(abandoned).rejects.toThrow()

    expect(inner.signals[0]?.aborted).toBe(false)
  })

  it('explains that other callers are unaffected when one abandons', async () => {
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader)
    const controller = new AbortController()
    const abandoned = shared.load(entryFor('reports'), { signal: controller.signal })

    controller.abort()

    await abandoned.catch((error: unknown) => {
      expect(isMfeError(error)).toBe(true)
      expect((error as Error).message).toContain('the caller stopped waiting')
      expect((error as Error).message).toContain('Other callers waiting on the same container')
    })
    settle(inner.pending[0], loadedFor('reports'))
  })

  it('rejects immediately for a caller whose signal was already aborted', async () => {
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader)
    const controller = new AbortController()
    controller.abort()

    await expect(
      shared.load(entryFor('reports'), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'load/entry-failure' })

    settle(inner.pending[0], loadedFor('reports'))
  })
})

describe('preload', () => {
  it('resolves the container’s code without creating a mount', async () => {
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader)
    const entry = entryFor('reports')

    const warming = shared.preload(entry, { signal: new AbortController().signal })
    const loaded = loadedFor('reports')
    settle(inner.pending[0], loaded)
    await expect(warming).resolves.toBeUndefined()

    // a later real navigation is served from the warmed cache.
    await expect(shared.load(entry, { signal: new AbortController().signal })).resolves.toBe(loaded)
    expect(inner.load).toHaveBeenCalledTimes(1)
  })

  it('does not reject when the speculative load failed', async () => {
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader)

    const warming = shared.preload(entryFor('reports'), { signal: new AbortController().signal })
    inner.pending[0]?.reject(new Error('remote is down'))

    await expect(warming).resolves.toBeUndefined()
  })

  it('does not reject when the caller abandons the speculative load', async () => {
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader)
    const controller = new AbortController()

    const warming = shared.preload(entryFor('reports'), { signal: controller.signal })
    controller.abort()

    await expect(warming).resolves.toBeUndefined()
    settle(inner.pending[0], loadedFor('reports'))
  })

  it('delegates to the inner loader’s own preload when it has one', async () => {
    const preload = vi.fn(async () => undefined)
    const load = vi.fn(async () => loadedFor('reports'))
    const shared = new SharedContainerLoader<TestModule>({ load, preload })
    const entry = entryFor('reports')
    const signal = new AbortController().signal

    await shared.preload(entry, { signal })

    expect(preload).toHaveBeenCalledWith(entry, { signal })
    expect(load).not.toHaveBeenCalled()
  })
})
