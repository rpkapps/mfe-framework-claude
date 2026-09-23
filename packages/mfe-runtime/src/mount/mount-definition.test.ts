/**
 * Every host mounts every definition through `mountDefinition`, so these definitions are plain
 * DOM written for the test: nothing here knows a framework, and whatever a real adapter's
 * definition does, the runtime only ever sees `mount`, `update` and `dispose`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  createMfeError,
  DEFINITION_BRAND,
  isMfeError,
  type DeadlineConfig,
  type MountState,
} from '@company/mfe-core'

import { at, codesOf, deferred, flush, type Deferred } from '../__tests__/harness.ts'
import {
  SharedContainerLoader,
  type ContainerLoader,
  type LoadedDefinition,
} from '../loader/container-loader.ts'
import type { MfeRuntime } from '../runtime/create-runtime.ts'
import { createMemoryRuntime, type MemoryRuntime } from '../testing/memory-runtime.ts'
import { createMountContext } from './mount-context.ts'
import {
  mountDefinition,
  type DefinitionMount,
  type WidgetDefinitionMount,
  type WidgetMountRequest,
} from './mount-definition.ts'
import type {
  AppMountTarget,
  MountableAppDefinition,
  MountableDefinition,
  MountableWidgetDefinition,
  MountedApp,
  MountedWidget,
  WidgetMountTarget,
} from './mountable-definition.ts'
import {
  KIND_ATTRIBUTE,
  MOUNT_ATTRIBUTE,
  OVERLAY_ROOT_ATTRIBUTE,
  SCOPE_ATTRIBUTE,
} from './scope-root.ts'

/** No adapter in the repository is called this, which is the point. */
const FRAMEWORK = 'plain-dom'

type Inputs = Readonly<Record<string, unknown>>

interface FakeApp {
  readonly definition: MountableAppDefinition
  readonly mount: ReturnType<typeof vi.fn<(target: AppMountTarget) => Promise<MountedApp>>>
  readonly dispose: ReturnType<typeof vi.fn<() => Promise<void>>>
  readonly targets: AppMountTarget[]
}

/** Writes where it was placed into its element; `mountWith` replaces the mount for one test. */
function plainApp(
  id = 'reports',
  mountWith?: (target: AppMountTarget, render: () => MountedApp) => Promise<MountedApp>,
): FakeApp {
  const targets: AppMountTarget[] = []
  const dispose = vi.fn(async () => undefined)

  const mount = vi.fn(async (target: AppMountTarget): Promise<MountedApp> => {
    targets.push(target)
    const render = (): MountedApp => {
      const view = target.element.ownerDocument.createElement('p')
      view.textContent = `${id} at ${target.context.basePath}`
      target.element.appendChild(view)
      return {
        dispose: async () => {
          await dispose()
          target.element.replaceChildren()
        },
      }
    }
    return mountWith === undefined ? render() : await mountWith(target, render)
  })

  const definition: MountableAppDefinition = {
    [DEFINITION_BRAND]: true,
    kind: 'app',
    id,
    version: '2.1.0',
    framework: FRAMEWORK,
    contributesBreadcrumbs: false,
    mount,
  }
  return { definition, mount, dispose, targets }
}

const ALERT_CONTRACT = {
  inputs: z.object({ label: z.string() }),
  events: { acknowledged: z.object({ alertId: z.string() }) },
}

interface FakeWidget {
  readonly definition: MountableWidgetDefinition
  readonly mount: ReturnType<typeof vi.fn<(target: WidgetMountTarget) => Promise<MountedWidget>>>
  readonly update: ReturnType<typeof vi.fn<(inputs: Inputs) => void>>
  readonly dispose: ReturnType<typeof vi.fn<() => Promise<void>>>
  readonly targets: WidgetMountTarget[]
}

function plainWidget(
  id = 'alert-panel',
  mountWith?: (target: WidgetMountTarget, render: () => MountedWidget) => Promise<MountedWidget>,
): FakeWidget {
  const targets: WidgetMountTarget[] = []
  const update = vi.fn()
  const dispose = vi.fn(async () => undefined)

  const mount = vi.fn(async (target: WidgetMountTarget): Promise<MountedWidget> => {
    targets.push(target)
    const render = (): MountedWidget => {
      target.element.textContent = String(target.inputs['label'])
      return {
        update: inputs => {
          update(inputs)
          target.element.textContent = String(inputs['label'])
        },
        dispose: async () => {
          await dispose()
          target.element.replaceChildren()
        },
      }
    }
    return mountWith === undefined ? render() : await mountWith(target, render)
  })

  const definition: MountableWidgetDefinition = {
    [DEFINITION_BRAND]: true,
    kind: 'widget',
    id,
    framework: FRAMEWORK,
    contract: ALERT_CONTRACT,
    mount,
  }
  return { definition, mount, update, dispose, targets }
}

let memories: MemoryRuntime[] = []
let host: HTMLElement

beforeEach(() => {
  host = document.createElement('section')
  document.body.appendChild(host)
})

afterEach(() => {
  for (const memory of memories) memory.dispose()
  memories = []
  document.body.replaceChildren()
  vi.useRealTimers()
})

function memoryRuntime(
  definitions: readonly MountableDefinition[],
  deadlines?: Partial<DeadlineConfig>,
): MemoryRuntime {
  const memory = createMemoryRuntime({
    definitions,
    ...(deadlines === undefined ? {} : { deadlines }),
  })
  memories.push(memory)
  return memory
}

function loadedOf(definition: MountableDefinition): LoadedDefinition {
  return { identity: { id: definition.id, kind: definition.kind }, module: definition }
}

/** The same runtime with a loader a test controls, shared the way a shell's is. */
function withLoader(runtime: MfeRuntime, inner: ContainerLoader): MfeRuntime {
  return { ...runtime, loader: new SharedContainerLoader(inner) }
}

/** A loader whose every load waits on a deferred the test settles. */
function pendingLoader(): {
  readonly loader: ContainerLoader
  readonly loads: Deferred<LoadedDefinition>[]
} {
  const loads: Deferred<LoadedDefinition>[] = []
  return {
    loads,
    loader: {
      load: () => {
        const next = deferred<LoadedDefinition>()
        loads.push(next)
        return next.promise
      },
    },
  }
}

function mountApp(runtime: MfeRuntime, id = 'reports', basePath = '/reports'): DefinitionMount {
  return mountDefinition({ runtime, element: host, definitionId: id, kind: 'app', basePath })
}

function mountWidget(
  runtime: MfeRuntime,
  extras: Partial<Omit<WidgetMountRequest, 'runtime' | 'kind' | 'element'>> = {},
): WidgetDefinitionMount {
  return mountDefinition({
    runtime,
    element: host,
    definitionId: 'alert-panel',
    kind: 'widget',
    inputs: { label: 'Pressure high' },
    onEvent: () => undefined,
    ...extras,
  })
}

async function settled(mount: DefinitionMount, status: MountState['status']): Promise<void> {
  await vi.waitFor(() => expect(mount.getState().status).toBe(status))
}

function scopeRoots(): readonly Element[] {
  return [...document.querySelectorAll(`[${SCOPE_ATTRIBUTE}]:not([${OVERLAY_ROOT_ATTRIBUTE}])`)]
}

function overlayRoots(): readonly Element[] {
  return [...document.querySelectorAll(`[${OVERLAY_ROOT_ATTRIBUTE}]`)]
}

function errorOf(mount: DefinitionMount): { readonly code: string; readonly message: string } {
  const state = mount.getState()
  if (state.status !== 'error') throw new Error(`expected an error state, saw "${state.status}"`)
  return { code: state.error.code, message: state.error.message }
}

describe('mounting', () => {
  it('moves from pending to mounted and publishes every step', async () => {
    const app = plainApp()
    const { runtime } = memoryRuntime([app.definition])
    const mount = mountApp(runtime)
    const seen: string[] = []
    mount.subscribe(() => seen.push(mount.getState().status))

    expect(mount.state).toEqual({ status: 'pending', attempt: 1 })
    await settled(mount, 'mounted')

    expect(mount.id).toBe('reports')
    expect(seen).toEqual(['mounted'])
    expect(host.textContent).toBe('reports at /reports')
  })

  it('renders inside one scope root it owns, with the definition’s element inside that', async () => {
    const app = plainApp()
    const { runtime } = memoryRuntime([app.definition])
    const mount = mountApp(runtime)
    await settled(mount, 'mounted')

    const scopeRoot = at([...host.children])
    const target = at(app.targets)
    expect(host.children).toHaveLength(1)
    expect(scopeRoot.getAttribute(SCOPE_ATTRIBUTE)).toBe('reports')
    expect(scopeRoot.getAttribute(MOUNT_ATTRIBUTE)).toBe(target.context.mountToken)
    expect(scopeRoot.getAttribute(KIND_ATTRIBUTE)).toBe('app')
    expect(target.element.parentElement).toBe(scopeRoot)
    expect(target.element.style.display).toBe('contents')
    expect(target.context.scopeRoot).toBe(scopeRoot)
    expect(mount.context).toBe(target.context)
  })

  it('never mounts from inside the call that asked for it', () => {
    const app = plainApp()
    const { runtime } = memoryRuntime([app.definition])

    mountApp(runtime)

    expect(app.mount).not.toHaveBeenCalled()
    expect(host.children).toHaveLength(0)
  })

  it('gives an App its boundary, and a top-level mount depth 1', async () => {
    const app = plainApp()
    const { runtime } = memoryRuntime([app.definition])
    const mount = mountApp(runtime, 'reports', '/ops/reports')
    await settled(mount, 'mounted')

    expect(at(app.targets).context).toMatchObject({
      definitionId: 'reports',
      definitionVersion: '2.1.0',
      kind: 'app',
      basePath: '/ops/reports',
      depth: 1,
    })
  })

  it('places a mount inside another one level deeper', async () => {
    const outer = plainApp('reports')
    const inner = plainWidget()
    const { runtime } = memoryRuntime([outer.definition, inner.definition])
    const parent = mountApp(runtime)
    await settled(parent, 'mounted')

    const child = mountWidget(runtime, { parent: parent.context })
    await settled(child, 'mounted')

    expect(at(inner.targets).context.depth).toBe(2)
  })
})

/** What a test waits on instead of guessing at a framework's scheduler. */
describe('waiting until the mounted definition is stable', () => {
  it('waits on the mounted definition’s own whenStable', async () => {
    const rendering = deferred<undefined>()
    const whenStable = vi.fn(() => rendering.promise)
    const app = plainApp('reports', async (_target, render) => ({ ...render(), whenStable }))
    const { runtime } = memoryRuntime([app.definition])
    const mount = mountApp(runtime)
    await settled(mount, 'mounted')

    let stable = false
    const waiting = mount.whenStable().then(() => {
      stable = true
    })
    await flush()
    expect(whenStable).toHaveBeenCalledOnce()
    expect(stable).toBe(false)

    rendering.resolve(undefined)
    await waiting
    expect(stable).toBe(true)
  })

  it('resolves at once while nothing is mounted, or for a definition that offers none', async () => {
    const app = plainApp()
    const { runtime } = memoryRuntime([app.definition])
    const mount = mountApp(runtime)

    await expect(mount.whenStable()).resolves.toBeUndefined()
    await settled(mount, 'mounted')
    await expect(mount.whenStable()).resolves.toBeUndefined()
    await mount.dispose()
    await expect(mount.whenStable()).resolves.toBeUndefined()
  })
})

describe('resolving what to mount', () => {
  it('reports an id the registry does not list, without loading anything', async () => {
    const memory = memoryRuntime([])
    const load = vi.spyOn(memory.runtime.loader, 'load')

    const mount = mountApp(memory.runtime, 'missing')
    await settled(mount, 'error')

    expect(errorOf(mount).code).toBe('registry/invalid-entry')
    expect(errorOf(mount).message).toContain('no registry entry with this id')
    expect(load).not.toHaveBeenCalled()
    expect(codesOf(memory.diagnostics)).toEqual(['registry/invalid-entry'])
  })

  it('refuses a Widget placed as an App before loading it', async () => {
    const widget = plainWidget()
    const memory = memoryRuntime([widget.definition])
    const load = vi.spyOn(memory.runtime.loader, 'load')

    const mount = mountApp(memory.runtime, 'alert-panel')
    await settled(mount, 'error')

    expect(errorOf(mount).message).toContain('an entry for a Widget')
    expect(load).not.toHaveBeenCalled()
  })
})

describe('failure and retry', () => {
  it('settles a failed load into one diagnostic, and loads afresh on retry', async () => {
    const app = plainApp()
    const memory = memoryRuntime([app.definition])
    let loads = 0
    const runtime = withLoader(memory.runtime, {
      load: async () => {
        loads += 1
        if (loads === 1) throw new Error('remote unreachable')
        return loadedOf(app.definition)
      },
    })

    const mount = mountApp(runtime)
    await settled(mount, 'error')

    expect(errorOf(mount).message).toContain('remote unreachable')
    expect(memory.diagnostics).toHaveLength(1)
    expect(host.children).toHaveLength(0)

    mount.retry()
    await settled(mount, 'mounted')

    expect(loads).toBe(2)
    expect(memory.diagnostics).toHaveLength(1)
  })

  it('retries a failed mount without loading again, in a fresh scope root and context', async () => {
    let attempts = 0
    const app = plainApp('reports', async (_target, render) => {
      attempts += 1
      if (attempts === 1) throw new Error('render threw')
      return render()
    })
    const memory = memoryRuntime([app.definition])
    const load = vi.spyOn(memory.runtime.loader, 'load')

    const mount = mountApp(memory.runtime)
    await settled(mount, 'error')
    expect(host.children).toHaveLength(0)
    expect(codesOf(memory.diagnostics)).toEqual(['mount/failure'])

    mount.retry()
    await settled(mount, 'mounted')

    expect(load).toHaveBeenCalledTimes(1)
    expect(app.mount).toHaveBeenCalledTimes(2)
    expect(at(app.targets, 0).context.mountToken).not.toBe(at(app.targets, 1).context.mountToken)
    expect(scopeRoots()).toHaveLength(1)
    expect(memory.diagnostics).toHaveLength(1)
  })

  it('does not call mount from inside retry()', async () => {
    let attempts = 0
    const app = plainApp('reports', async (_target, render) => {
      attempts += 1
      if (attempts === 1) throw new Error('render threw')
      return render()
    })
    const { runtime } = memoryRuntime([app.definition])
    const mount = mountApp(runtime)
    await settled(mount, 'error')

    mount.retry()

    expect(app.mount).toHaveBeenCalledTimes(1)
    await settled(mount, 'mounted')
  })

  it('ignores retry unless the mount failed', async () => {
    const app = plainApp()
    const { runtime } = memoryRuntime([app.definition])
    const mount = mountApp(runtime)

    mount.retry()
    await settled(mount, 'mounted')
    mount.retry()
    await flush()

    expect(app.mount).toHaveBeenCalledTimes(1)
    expect(scopeRoots()).toHaveLength(1)
  })
})

describe('a fatal failure after mounting', () => {
  it('moves to error, tears the attempt down and reports it once', async () => {
    const app = plainApp()
    const memory = memoryRuntime([app.definition])
    const mount = mountApp(memory.runtime)
    await settled(mount, 'mounted')

    at(app.targets).onFailure?.(new Error('root unmounted itself'))

    expect(errorOf(mount).message).toContain('root unmounted itself')
    expect(host.children).toHaveLength(0)
    await vi.waitFor(() => expect(app.dispose).toHaveBeenCalledTimes(1))
    expect(overlayRoots()).toHaveLength(0)
    expect(codesOf(memory.diagnostics)).toEqual(['mount/failure'])
  })

  it('mounts again on retry with a fresh mount token and without reloading', async () => {
    const app = plainApp()
    const memory = memoryRuntime([app.definition])
    const load = vi.spyOn(memory.runtime.loader, 'load')
    const mount = mountApp(memory.runtime)
    await settled(mount, 'mounted')
    const first = at(app.targets).context.mountToken

    at(app.targets).onFailure?.(new Error('root unmounted itself'))
    mount.retry()
    await settled(mount, 'mounted')

    expect(at(app.targets, 1).context.mountToken).not.toBe(first)
    expect(load).toHaveBeenCalledTimes(1)
    expect(scopeRoots()).toHaveLength(1)
  })

  it('ignores a failure reported by an attempt already torn down', async () => {
    const app = plainApp()
    const { runtime } = memoryRuntime([app.definition])
    const mount = mountApp(runtime)
    await settled(mount, 'mounted')
    const stale = at(app.targets)
    stale.onFailure?.(new Error('first'))
    mount.retry()
    await settled(mount, 'mounted')

    stale.onFailure?.(new Error('late, from the old attempt'))

    expect(mount.getState()).toEqual({ status: 'mounted' })
  })

  it('fails an attempt whose definition reports a failure before its mount resolves', async () => {
    const app = plainApp('reports', async (target, render) => {
      const mounted = render()
      target.onFailure?.(new Error('effect threw after the first render'))
      return await Promise.resolve(mounted)
    })
    const memory = memoryRuntime([app.definition])

    const mount = mountApp(memory.runtime)
    await settled(mount, 'error')

    expect(errorOf(mount).message).toContain('effect threw after the first render')
    await vi.waitFor(() => expect(app.dispose).toHaveBeenCalledTimes(1))
    expect(memory.diagnostics).toHaveLength(1)
  })
})

describe('disposal', () => {
  it('never mounts a definition whose load was still pending', async () => {
    const app = plainApp()
    const memory = memoryRuntime([app.definition])
    const { loader, loads } = pendingLoader()
    const mount = mountApp(withLoader(memory.runtime, loader))
    await vi.waitFor(() => expect(loads).toHaveLength(1))

    await mount.dispose()
    at(loads).resolve(loadedOf(app.definition))
    await flush()

    expect(app.mount).not.toHaveBeenCalled()
    expect(mount.getState()).toEqual({ status: 'disposed' })
    expect(host.children).toHaveLength(0)
    expect(memory.diagnostics).toEqual([])
  })

  it('disposes a definition whose mount was pending exactly once, when the mount resolves', async () => {
    const mounting = deferred<void>()
    const app = plainApp('reports', async (_target, render) => {
      await mounting.promise
      return render()
    })
    const { runtime } = memoryRuntime([app.definition])
    const mount = mountApp(runtime)
    await vi.waitFor(() => expect(app.mount).toHaveBeenCalledTimes(1))

    const disposal = mount.dispose()

    expect(host.children).toHaveLength(0)
    expect(mount.getState()).toEqual({ status: 'disposed' })
    mounting.resolve()
    await disposal
    await flush()

    expect(app.dispose).toHaveBeenCalledTimes(1)
    expect(overlayRoots()).toHaveLength(0)
  })

  it('leaves no scope root and no overlay root behind', async () => {
    const app = plainApp()
    const widget = plainWidget()
    const { runtime } = memoryRuntime([app.definition, widget.definition])
    const appMount = mountApp(runtime)
    const widgetMount = mountWidget(runtime)
    await settled(appMount, 'mounted')
    await settled(widgetMount, 'mounted')
    expect(scopeRoots()).toHaveLength(2)
    expect(overlayRoots()).toHaveLength(2)

    await Promise.all([appMount.dispose(), widgetMount.dispose()])

    expect(scopeRoots()).toHaveLength(0)
    expect(overlayRoots()).toHaveLength(0)
    expect(appMount.context).toBeNull()
  })

  it('disposes the definition before its context', async () => {
    const aborted: boolean[] = []
    const app = plainApp('reports', async (target, render) => {
      const mounted = render()
      return await Promise.resolve({
        dispose: async () => {
          aborted.push(target.context.signal.aborted)
          await mounted.dispose()
        },
      })
    })
    const { runtime } = memoryRuntime([app.definition])
    const mount = mountApp(runtime)
    await settled(mount, 'mounted')
    const { context } = at(app.targets)

    await mount.dispose()

    expect(aborted).toEqual([false])
    expect(context.signal.aborted).toBe(true)
  })

  it('runs the teardown once however many times it is asked for', async () => {
    const app = plainApp()
    const { runtime } = memoryRuntime([app.definition])
    const mount = mountApp(runtime)
    await settled(mount, 'mounted')

    await Promise.all([mount.dispose(), mount.dispose()])
    await mount.dispose()

    expect(app.dispose).toHaveBeenCalledTimes(1)
  })

  it('is disposed with the mount it was placed inside', async () => {
    const widget = plainWidget()
    const { runtime } = memoryRuntime([widget.definition])
    const parent = createMountContext({ runtime, definitionId: 'reports', kind: 'app' })
    const mount = mountWidget(runtime, { parent: parent.context })
    await settled(mount, 'mounted')

    await parent.dispose()

    await settled(mount, 'disposed')
    await vi.waitFor(() => expect(widget.dispose).toHaveBeenCalledTimes(1))
    expect(host.children).toHaveLength(0)
  })

  it('never starts inside a mount that is already disposed', async () => {
    const widget = plainWidget()
    const memory = memoryRuntime([widget.definition])
    const parent = createMountContext({
      runtime: memory.runtime,
      definitionId: 'reports',
      kind: 'app',
    })
    await parent.dispose()
    const load = vi.spyOn(memory.runtime.loader, 'load')

    const mount = mountWidget(memory.runtime, { parent: parent.context })
    await settled(mount, 'disposed')

    expect(load).not.toHaveBeenCalled()
  })
})

describe('Widget inputs', () => {
  it('drops a set shallow-equal to the inputs the Widget has', async () => {
    const widget = plainWidget()
    const { runtime } = memoryRuntime([widget.definition])
    const mount = mountWidget(runtime)
    await settled(mount, 'mounted')

    mount.update({ label: 'Pressure high' })
    mount.update({ label: 'Pressure critical' })
    mount.update({ label: 'Pressure critical' })

    expect(widget.update).toHaveBeenCalledTimes(1)
    expect(widget.update).toHaveBeenCalledWith({ label: 'Pressure critical' })
    expect(host.textContent).toBe('Pressure critical')
  })

  it('mounts with the latest inputs when they changed while it loaded', async () => {
    const widget = plainWidget()
    const memory = memoryRuntime([widget.definition])
    const { loader, loads } = pendingLoader()
    const mount = mountWidget(withLoader(memory.runtime, loader))

    mount.update({ label: 'second' })
    mount.update({ label: 'third' })
    await vi.waitFor(() => expect(loads).toHaveLength(1))
    at(loads).resolve(loadedOf(widget.definition))
    await settled(mount, 'mounted')

    expect(at(widget.targets).inputs).toEqual({ label: 'third' })
    expect(widget.update).not.toHaveBeenCalled()
  })

  it('delivers the inputs that changed while it mounted once, as its first update', async () => {
    const mounting = deferred<void>()
    const widget = plainWidget('alert-panel', async (_target, render) => {
      await mounting.promise
      return render()
    })
    const { runtime } = memoryRuntime([widget.definition])
    const mount = mountWidget(runtime)
    await vi.waitFor(() => expect(widget.mount).toHaveBeenCalledTimes(1))

    mount.update({ label: 'second' })
    mount.update({ label: 'third' })
    mounting.resolve()
    await settled(mount, 'mounted')

    expect(at(widget.targets).inputs).toEqual({ label: 'Pressure high' })
    expect(widget.update.mock.calls).toEqual([[{ label: 'third' }]])
    expect(host.textContent).toBe('third')
  })

  it('sends nothing after mounting when the inputs changed back meanwhile', async () => {
    const mounting = deferred<void>()
    const widget = plainWidget('alert-panel', async (_target, render) => {
      await mounting.promise
      return render()
    })
    const { runtime } = memoryRuntime([widget.definition])
    const mount = mountWidget(runtime)
    await vi.waitFor(() => expect(widget.mount).toHaveBeenCalledTimes(1))

    mount.update({ label: 'second' })
    mount.update({ label: 'Pressure high' })
    mounting.resolve()
    await settled(mount, 'mounted')

    expect(widget.update).not.toHaveBeenCalled()
  })

  it('mounts a retry with the latest inputs', async () => {
    let attempts = 0
    const widget = plainWidget('alert-panel', async (_target, render) => {
      attempts += 1
      if (attempts === 1) throw new Error('render threw')
      return render()
    })
    const { runtime } = memoryRuntime([widget.definition])
    const mount = mountWidget(runtime)
    await settled(mount, 'error')

    mount.update({ label: 'while failed' })
    mount.retry()
    await settled(mount, 'mounted')

    expect(at(widget.targets, 1).inputs).toEqual({ label: 'while failed' })
    expect(widget.update).not.toHaveBeenCalled()
  })

  it('ignores updates once disposed', async () => {
    const widget = plainWidget()
    const { runtime } = memoryRuntime([widget.definition])
    const mount = mountWidget(runtime)
    await settled(mount, 'mounted')
    await mount.dispose()

    mount.update({ label: 'too late' })

    expect(widget.update).not.toHaveBeenCalled()
  })

  it('passes on the Widget’s own rejection of an update', async () => {
    const onInputRejected = vi.fn()
    const widget = plainWidget()
    const { runtime } = memoryRuntime([widget.definition])
    const mount = mountWidget(runtime, { onInputRejected })
    await settled(mount, 'mounted')
    const rejection = createMfeError({
      code: 'contract/input-mismatch',
      id: 'alert-panel',
      operation: 'accept input',
      repair: 'Pass a string label.',
    })

    at(widget.targets).onInputRejected?.(rejection)

    expect(onInputRejected).toHaveBeenCalledWith(rejection)
  })
})

describe('Widget events', () => {
  it('delivers an event the host declared nothing about as the Widget emitted it', async () => {
    const onEvent = vi.fn()
    const widget = plainWidget()
    const { runtime } = memoryRuntime([widget.definition])
    const mount = mountWidget(runtime, { onEvent })
    await settled(mount, 'mounted')

    at(widget.targets).emit('acknowledged', { alertId: 'a-7', extra: true })

    expect(onEvent).toHaveBeenCalledWith('acknowledged', { alertId: 'a-7', extra: true })
  })

  it('delivers what the host’s own contract accepted', async () => {
    const onEvent = vi.fn()
    const widget = plainWidget()
    const { runtime } = memoryRuntime([widget.definition])
    const mount = mountWidget(runtime, { onEvent, consumerEvents: ALERT_CONTRACT.events })
    await settled(mount, 'mounted')

    at(widget.targets).emit('acknowledged', { alertId: 'a-7', extra: true })

    expect(onEvent).toHaveBeenCalledWith('acknowledged', { alertId: 'a-7' })
  })

  it('reports a payload the host’s contract refuses, and never throws into the Widget', async () => {
    const onEvent = vi.fn()
    const widget = plainWidget()
    const memory = memoryRuntime([widget.definition])
    const mount = mountWidget(memory.runtime, { onEvent, consumerEvents: ALERT_CONTRACT.events })
    await settled(mount, 'mounted')

    expect(() => {
      at(widget.targets).emit('acknowledged', { alertId: 7 })
    }).not.toThrow()

    expect(onEvent).not.toHaveBeenCalled()
    expect(memory.diagnostics).toHaveLength(1)
    expect(at(memory.diagnostics)).toMatchObject({
      error: { code: 'contract/event-mismatch', id: 'alert-panel' },
      context: { widget: 'alert-panel', event: 'acknowledged' },
    })
    expect(isMfeError(at(memory.diagnostics).error)).toBe(true)
    expect(mount.getState()).toEqual({ status: 'mounted' })
  })

  it('drops what an attempt that was torn down still emits', async () => {
    const onEvent = vi.fn()
    const widget = plainWidget()
    const { runtime } = memoryRuntime([widget.definition])
    const mount = mountWidget(runtime, { onEvent })
    await settled(mount, 'mounted')
    const stale = at(widget.targets)
    await mount.dispose()

    stale.emit('acknowledged', { alertId: 'a-7' })

    expect(onEvent).not.toHaveBeenCalled()
  })
})

describe('deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('fails a load that outruns the runtime’s load deadline', async () => {
    const app = plainApp()
    const memory = memoryRuntime([app.definition], { load: 1_000 })
    const { loader } = pendingLoader()

    const mount = mountApp(withLoader(memory.runtime, loader))
    await vi.advanceTimersByTimeAsync(1_000)

    expect(errorOf(mount).code).toBe('load/timeout')
    expect(errorOf(mount).message).toContain('within 1000ms')
    expect(app.mount).not.toHaveBeenCalled()
    expect(codesOf(memory.diagnostics)).toEqual(['load/timeout'])
  })

  it('fails a mount that outruns the mount deadline, and disposes it if it resolves later', async () => {
    const mounting = deferred<void>()
    const app = plainApp('reports', async (_target, render) => {
      await mounting.promise
      return render()
    })
    const memory = memoryRuntime([app.definition], { mount: 1_000 })

    const mount = mountApp(memory.runtime)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(errorOf(mount).code).toBe('mount/timeout')
    expect(host.children).toHaveLength(0)

    mounting.resolve()
    await vi.advanceTimersByTimeAsync(0)

    expect(app.dispose).toHaveBeenCalledTimes(1)
    expect(overlayRoots()).toHaveLength(0)
  })
})
