/**
 * What one mount attempt places: the registry says what an id is before anything downloads, the
 * loaded module has to be a definition that mounts itself, and no failure is remembered, so the
 * attempt after one is a genuinely fresh one.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFINITION_BRAND,
  isMfeError,
  type BrandedDefinition,
  type MfeError,
} from '@company/mfe-core'

import {
  SharedContainerLoader,
  type ContainerLoader,
  type LoadedDefinition,
} from '../loader/container-loader.ts'
import type { MfeRuntime } from '../runtime/create-runtime.ts'
import { createMemoryRuntime, type MemoryRuntime } from '../testing/memory-runtime.ts'
import type { MountableAppDefinition } from './mountable-definition.ts'
import { resolveDefinition } from './resolve-definition.ts'

const REPORTS: MountableAppDefinition = {
  [DEFINITION_BRAND]: true,
  kind: 'app',
  id: 'reports',
  framework: 'plain-dom',
  contributesBreadcrumbs: false,
  mount: async () => ({ dispose: async () => undefined }),
}

let memories: MemoryRuntime[] = []

afterEach(() => {
  for (const memory of memories) memory.dispose()
  memories = []
})

/** A runtime listing `definitions`, loading through `inner` when a test needs to control it. */
function runtimeWith(
  definitions: readonly BrandedDefinition[],
  inner?: ContainerLoader,
): MfeRuntime {
  const memory = createMemoryRuntime({ definitions })
  memories.push(memory)
  return inner === undefined
    ? memory.runtime
    : { ...memory.runtime, loader: new SharedContainerLoader(inner) }
}

function loadedOf(module: unknown): LoadedDefinition {
  return { identity: { id: 'reports', kind: 'app' }, module }
}

const liveSignal = (): AbortSignal => new AbortController().signal

async function rejection(promise: Promise<unknown>): Promise<MfeError> {
  const thrown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  )
  if (!isMfeError(thrown)) throw new Error('expected an MfeError rejection')
  return thrown
}

describe('resolveDefinition', () => {
  it('resolves the mountable definition the registry lists under the id', async () => {
    const runtime = runtimeWith([REPORTS])

    await expect(resolveDefinition(runtime, 'reports', 'app', liveSignal())).resolves.toBe(REPORTS)
  })

  it('refuses an id the registry does not list, without loading anything', async () => {
    const load = vi.fn()
    const runtime = runtimeWith([], { load })

    const error = await rejection(resolveDefinition(runtime, 'reports', 'app', liveSignal()))

    expect(error.code).toBe('registry/invalid-entry')
    expect(error.message).toContain('reports failed to resolve App: no registry entry with this id')
    expect(load).not.toHaveBeenCalled()
  })

  it('refuses an App placed as a Widget before loading it', async () => {
    const load = vi.fn()
    const runtime = runtimeWith([REPORTS], { load })

    const error = await rejection(resolveDefinition(runtime, 'reports', 'widget', liveSignal()))

    expect(error.code).toBe('registry/invalid-entry')
    expect(error.message).toContain('expected an entry for a Widget, received an entry for an App')
    expect(load).not.toHaveBeenCalled()
  })

  it('refuses a branded definition that cannot mount itself, naming its adapter', async () => {
    const withoutMount = { ...REPORTS, framework: 'elsewhere', mount: undefined }
    const runtime = runtimeWith([REPORTS], { load: async () => loadedOf(withoutMount) })

    const error = await rejection(resolveDefinition(runtime, 'reports', 'app', liveSignal()))

    expect(error.code).toBe('load/entry-failure')
    expect(error.message).toContain('the elsewhere adapter that cannot mount itself')
    expect(error.message).toContain('Export the App from src/mfe.ts')
  })

  it('refuses a module that is not a definition at all', async () => {
    const runtime = runtimeWith([REPORTS], { load: async () => loadedOf({ default: 42 }) })

    const error = await rejection(resolveDefinition(runtime, 'reports', 'app', liveSignal()))

    expect(error.message).toContain('a module that is not a framework definition')
  })

  it('keeps no failure, so the next resolution loads again', async () => {
    let loads = 0
    const runtime = runtimeWith([REPORTS], {
      load: async () => {
        loads += 1
        if (loads === 1) throw new Error('remote unreachable')
        return loadedOf(REPORTS)
      },
    })

    await expect(resolveDefinition(runtime, 'reports', 'app', liveSignal())).rejects.toThrow(
      'remote unreachable',
    )
    await expect(resolveDefinition(runtime, 'reports', 'app', liveSignal())).resolves.toBe(REPORTS)
    expect(loads).toBe(2)
  })

  it('stops waiting when its signal aborts', async () => {
    const runtime = runtimeWith([REPORTS], { load: () => new Promise(() => undefined) })
    const controller = new AbortController()

    const resolving = resolveDefinition(runtime, 'reports', 'app', controller.signal)
    controller.abort(new Error('the mount was disposed'))

    expect((await rejection(resolving)).message).toContain('stopped waiting')
  })
})
