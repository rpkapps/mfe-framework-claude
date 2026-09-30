import { afterEach, describe, expect, it, vi } from 'vitest'

import { isMfeError, type RegistryEntry } from '@company/mfe-core'

import {
  SharedContainerLoader,
  type ContainerLoader,
  type LoadedDefinition,
} from './container-loader.ts'
import { createInProcessLoader } from '../testing/in-process-loader.ts'
import { deferred, type Deferred } from '../__tests__/harness.ts'

interface TestModule {
  readonly name: string
}

function entryFor(id: string): RegistryEntry {
  return {
    id,
    definitionKind: 'app',
    adapter: 'react',
    manifestUrl: `https://cdn.example.test/${id}/mf-manifest.json`,
    requiresRuntime: '>=1.1.0 <2.0.0',
  }
}

function loadedFor(id: string): LoadedDefinition<TestModule> {
  return { identity: { id, kind: 'app' }, module: { name: id } }
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
      _entry: RegistryEntry,
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

describe('shared load deadlines', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('expires and aborts one hung attempt for every waiter, then starts a fresh retry', async () => {
    vi.useFakeTimers()
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader, { deadlineMs: 100 })
    const entry = entryFor('reports')
    const first = shared.load(entry, { signal: new AbortController().signal })
    const sibling = shared.load(entry, { signal: new AbortController().signal })
    const firstFailure = expect(first).rejects.toMatchObject({ code: 'load/timeout' })
    const siblingFailure = expect(sibling).rejects.toMatchObject({ code: 'load/timeout' })

    await vi.advanceTimersByTimeAsync(100)
    await Promise.all([firstFailure, siblingFailure])

    expect(shared.inFlightCount).toBe(0)
    expect(inner.signals[0]?.aborted).toBe(true)
    const retry = shared.load(entry, { signal: new AbortController().signal })
    const loaded = loadedFor('reports')
    settle(inner.pending[1], loaded)
    await expect(retry).resolves.toBe(loaded)
    expect(inner.load).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let late completion cache an expired result or evict the new attempt', async () => {
    vi.useFakeTimers()
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader, { deadlineMs: 100 })
    const entry = entryFor('reports')
    const expired = shared.load(entry, { signal: new AbortController().signal })
    const expiredFailure = expect(expired).rejects.toMatchObject({ code: 'load/timeout' })
    await vi.advanceTimersByTimeAsync(100)
    await expiredFailure

    const retry = shared.load(entry, { signal: new AbortController().signal })
    settle(inner.pending[0], { ...loadedFor('reports'), module: { name: 'expired' } })
    await Promise.resolve()
    expect(shared.inFlightCount).toBe(1)
    const joining = shared.load(entry, { signal: new AbortController().signal })
    const current = { ...loadedFor('reports'), module: { name: 'current' } }
    settle(inner.pending[1], current)
    await expect(Promise.all([retry, joining])).resolves.toEqual([current, current])
    await expect(shared.load(entry, { signal: new AbortController().signal })).resolves.toBe(
      current,
    )
    expect(inner.load).toHaveBeenCalledTimes(2)
  })

  it('observes a late rejection from an expired underlying load', async () => {
    vi.useFakeTimers()
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader, { deadlineMs: 100 })
    const expired = shared.load(entryFor('reports'), { signal: new AbortController().signal })
    const failure = expect(expired).rejects.toMatchObject({ code: 'load/timeout' })
    await vi.advanceTimersByTimeAsync(100)
    await failure

    inner.pending[0]?.reject(new Error('the expired network request eventually rejected'))
    await Promise.resolve()
    expect(shared.inFlightCount).toBe(0)
  })

  it('bounds even speculative work delegated to an inner preload', async () => {
    vi.useFakeTimers()
    let observed: AbortSignal | undefined
    const preload = vi.fn((_entry: RegistryEntry, { signal }: { signal: AbortSignal }) => {
      observed = signal
      return new Promise<void>(() => {})
    })
    const shared = new SharedContainerLoader(
      { load: async () => loadedFor('reports'), preload },
      { deadlineMs: 100 },
    )
    const warming = shared.preload(entryFor('reports'), { signal: new AbortController().signal })
    await vi.advanceTimersByTimeAsync(100)
    await expect(warming).resolves.toBeUndefined()
    expect(observed?.aborted).toBe(true)
  })

  it.each([0, -1, Infinity, NaN])(
    'rejects a nonfinite or nonpositive deadline (%s)',
    deadlineMs => {
      expect(
        () => new SharedContainerLoader(createControllableLoader().loader, { deadlineMs }),
      ).toThrow(/finite, positive deadlineMs/)
    },
  )
})

describe('abandoning a shared load', () => {
  it('does not cancel work another caller still needs', async () => {
    const inner = createControllableLoader()
    const shared = new SharedContainerLoader(inner.loader)
    const entry = entryFor('reports')
    const abandoning = new AbortController()
    const waiting = new AbortController()
    const abandoned = shared.load(entry, { signal: abandoning.signal })
    const stillWaiting = shared.load(entry, { signal: waiting.signal })

    // the first mount is disposed mid-load.
    abandoning.abort()

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
    settle(inner.pending[0], loadedFor('reports'))
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

    expect(inner.load).not.toHaveBeenCalled()
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
    const preload = vi.fn(
      async (_entry: RegistryEntry, _options: { signal: AbortSignal }) => undefined,
    )
    const load = vi.fn(async () => loadedFor('reports'))
    const shared = new SharedContainerLoader<TestModule>({ load, preload })
    const entry = entryFor('reports')
    const signal = new AbortController().signal

    await shared.preload(entry, { signal })

    const preloadSignal = preload.mock.calls[0]?.[1].signal
    expect(preload).toHaveBeenCalledWith(entry, { signal: preloadSignal })
    expect(preloadSignal).toBeInstanceOf(AbortSignal)
    expect(preloadSignal).not.toBe(signal)
    expect(load).not.toHaveBeenCalled()
  })
})
