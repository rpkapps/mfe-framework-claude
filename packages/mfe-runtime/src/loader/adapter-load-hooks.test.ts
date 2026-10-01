import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MfeAdapter, RegistryEntry } from '@company/mfe-core'

import { withAdapterLoadHooks } from './adapter-load-hooks.ts'
import { SharedContainerLoader, type LoadedDefinition } from './container-loader.ts'
import { deferred } from '../__tests__/harness.ts'

describe('adapter load hook cancellation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('releases evaluation state when the underlying loader ignores its shared deadline signal', async () => {
    vi.useFakeTimers()
    let evaluating = false
    const leave = vi.fn()
    const adapter: MfeAdapter = {
      kind: 'plain-dom',
      detect: () => false,
      is: (entry): entry is RegistryEntry => entry.adapter === 'plain-dom',
      parse: () => {
        throw new Error('unused')
      },
      aroundLoad: async load => {
        evaluating = true
        try {
          return await load()
        } finally {
          evaluating = false
          leave()
        }
      },
    }
    const pending = deferred<LoadedDefinition>()
    const shared = new SharedContainerLoader(
      withAdapterLoadHooks({ load: () => pending.promise }, [adapter]),
      { deadlineMs: 100 },
    )
    const entry: RegistryEntry = {
      id: 'reports',
      adapter: 'plain-dom',
      definitionKind: 'app',
      manifestUrl: 'https://edge.example.test/reports/mf-manifest.json',
      requiresRuntime: '>=1.1.0 <2.0.0',
    }
    const loading = shared.load(entry, { signal: new AbortController().signal })
    const failure = expect(loading).rejects.toMatchObject({ code: 'load/timeout' })
    expect(evaluating).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    await failure
    expect(evaluating).toBe(false)
    expect(leave).toHaveBeenCalledTimes(1)
    pending.resolve({ identity: { id: 'reports', kind: 'app' }, module: {} })
    await Promise.resolve()
    expect(leave).toHaveBeenCalledTimes(1)
  })
})
