/**
 * A mount context is everything one mount owns: it is scoped to its definition, isolated from a
 * second mount of the same definition, and torn down in an order a palette can never observe
 * half-way through.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createMemoryRuntime, type MemoryRuntime } from '../testing/memory-runtime.ts'
import { createMountContext, createMountToken, mountScopedStores } from './mount-context.ts'
import {
  KIND_ATTRIBUTE,
  MOUNT_ATTRIBUTE,
  OVERLAY_ROOT_ATTRIBUTE,
  SCOPE_ATTRIBUTE,
} from './scope-root.ts'

let memory: MemoryRuntime | null = null

afterEach(() => {
  memory?.dispose()
  memory = null
})

function runtime(): MemoryRuntime['runtime'] {
  memory = createMemoryRuntime()
  return memory.runtime
}

describe('createMountToken', () => {
  it('issues a different token for every mount of the same definition', () => {
    const first = createMountToken('alert-panel')
    const second = createMountToken('alert-panel')

    expect(first).not.toBe(second)
    expect(first.startsWith('alert-panel#')).toBe(true)
  })
})

describe('createMountContext', () => {
  it('describes the mount it was created for', () => {
    const { context } = createMountContext({
      runtime: runtime(),
      definitionId: 'reports',
      definitionVersion: '2.1.0',
      kind: 'app',
      basePath: '/reports',
      depth: 2,
    })

    expect(context).toMatchObject({
      definitionId: 'reports',
      definitionVersion: '2.1.0',
      kind: 'app',
      basePath: '/reports',
      depth: 2,
    })
    expect(context.signal.aborted).toBe(false)
  })

  it('gives a Widget no URL boundary, whatever it was passed', () => {
    const { context } = createMountContext({
      runtime: runtime(),
      definitionId: 'alert-panel',
      kind: 'widget',
      basePath: '/somewhere',
    })

    expect(context.basePath).toBe('')
    expect(context.depth).toBe(1)
  })

  it('creates a detached scope root stamped with its definition, its own token and its kind', () => {
    const { context } = createMountContext({
      runtime: runtime(),
      definitionId: 'alert-panel',
      kind: 'widget',
    })
    const { scopeRoot } = context

    expect(scopeRoot.getAttribute(SCOPE_ATTRIBUTE)).toBe('alert-panel')
    expect(scopeRoot.getAttribute(MOUNT_ATTRIBUTE)).toBe(context.mountToken)
    expect(scopeRoot.getAttribute(KIND_ATTRIBUTE)).toBe('widget')
    expect(scopeRoot.style.display).toBe('contents')
    expect(scopeRoot.isConnected).toBe(false)
  })

  it('creates its roots in the document it is given', () => {
    const other = document.implementation.createHTMLDocument('other')

    const { context } = createMountContext({
      runtime: runtime(),
      definitionId: 'reports',
      kind: 'app',
      document: other,
    })

    expect(context.scopeRoot.ownerDocument).toBe(other)
    expect(context.overlayRoot.ownerDocument).toBe(other)
  })

  it('scopes storage to the definition, so two mounts of it share their records', () => {
    const host = runtime()
    const first = createMountContext({ runtime: host, definitionId: 'reports', kind: 'app' })
    const second = createMountContext({ runtime: host, definitionId: 'reports', kind: 'app' })
    const other = createMountContext({ runtime: host, definitionId: 'alerts', kind: 'app' })

    first.context.storage.local.key('density', z.string()).set('compact')

    expect(first.context.mountToken).not.toBe(second.context.mountToken)
    expect(second.context.storage.local.key('density', z.string()).get()).toBe('compact')
    expect(other.context.storage.local.key('density', z.string()).get()).toBeNull()
  })

  it('attaches a body-level overlay root carrying the scope and the mount', () => {
    const { context } = createMountContext({
      runtime: runtime(),
      definitionId: 'alert-panel',
      kind: 'widget',
    })

    expect(context.overlayRoot.parentElement).toBe(document.body)
    expect(context.overlayRoot.getAttribute(SCOPE_ATTRIBUTE)).toBe('alert-panel')
    expect(context.overlayRoot.getAttribute(MOUNT_ATTRIBUTE)).toBe(context.mountToken)
    expect(context.overlayRoot.hasAttribute(OVERLAY_ROOT_ATTRIBUTE)).toBe(true)
  })

  it('attributes the telemetry it hands out to the mount', () => {
    const host = runtime()
    const { context } = createMountContext({
      runtime: host,
      definitionId: 'reports',
      definitionVersion: '2.1.0',
      kind: 'app',
    })

    context.telemetry.event('opened')

    expect(memory?.telemetry.events('opened')[0]?.attribution).toMatchObject({
      definitionId: 'reports',
      definitionKind: 'app',
      definitionVersion: '2.1.0',
      mountToken: context.mountToken,
    })
  })
})

describe('disposing a mount context', () => {
  it('names an App’s boundary to the agent, and not a Widget’s', async () => {
    memory = createMemoryRuntime({ initialEntries: ['/reports/q3'] })
    const host = memory.runtime
    const app = createMountContext({
      runtime: host,
      definitionId: 'reports',
      kind: 'app',
      basePath: '/reports',
    })
    createMountContext({ runtime: host, definitionId: 'alert-panel', kind: 'widget' })

    expect(host.agentContext.read().apps.map(located => located.definitionId)).toEqual(['reports'])

    await app.dispose()
    expect(host.agentContext.read().apps).toEqual([])
  })

  it('aborts the signal and removes the overlay root', async () => {
    const handle = createMountContext({ runtime: runtime(), definitionId: 'reports', kind: 'app' })

    await handle.dispose()

    expect(handle.context.signal.aborted).toBe(true)
    expect(handle.context.overlayRoot.isConnected).toBe(false)
  })

  /** Anything listening for the abort must find the mount already gone from the palette. */
  it('removes the mount’s actions, blockers and crumbs before it aborts', async () => {
    const host = runtime()
    const handle = createMountContext({ runtime: host, definitionId: 'reports', kind: 'app' })
    const { mountToken } = handle.context
    host.actions.register(handle.context, {
      name: 'refresh',
      label: 'Refresh',
      execute: () => undefined,
    })
    host.navigator.registerBlocker(mountToken, {
      depth: 1,
      shouldBlock: () => true,
      confirm: () => Promise.resolve('proceed'),
    })
    host.breadcrumbs
      .registerMount('reports', mountToken, 1)
      .update([{ key: 'r', label: 'Reports' }])

    const atAbort: { actions?: number; blockers?: number; crumbs?: number } = {}
    handle.context.signal.addEventListener('abort', () => {
      atAbort.actions = host.actions.getSnapshot().length
      atAbort.blockers = host.navigator.blockerCount
      atAbort.crumbs = host.breadcrumbs.getSnapshot().length
    })

    await handle.dispose()

    expect(atAbort).toEqual({ actions: 0, blockers: 0, crumbs: 0 })
  })

  /** A store that keeps records per mount and is left off the list would outlive the mount. */
  it('clears every runtime member that keeps records per mount', async () => {
    const host = runtime()
    const handle = createMountContext({ runtime: host, definitionId: 'reports', kind: 'app' })
    const perMount = Object.entries(host).filter(
      (entry): entry is [string, { removeMount: (token: string) => void }] =>
        typeof (entry[1] as { removeMount?: unknown } | null)?.removeMount === 'function',
    )
    const spies = perMount.map(([name, store]) => [name, vi.spyOn(store, 'removeMount')] as const)

    await handle.dispose()

    expect(perMount.map(([name]) => name).sort()).toEqual([
      'actions',
      'agentContext',
      'breadcrumbs',
      'navigator',
    ])
    expect(mountScopedStores(host)).toHaveLength(perMount.length)
    for (const [name, spy] of spies) {
      expect(spy, name).toHaveBeenCalledWith(handle.context.mountToken)
    }
  })

  it('leaves another mount of the same definition untouched', async () => {
    const host = runtime()
    const first = createMountContext({ runtime: host, definitionId: 'reports', kind: 'app' })
    const second = createMountContext({ runtime: host, definitionId: 'reports', kind: 'app' })
    host.actions.register(second.context, {
      name: 'refresh',
      label: 'Refresh',
      execute: () => undefined,
    })

    await first.dispose()

    expect(second.context.signal.aborted).toBe(false)
    expect(second.context.overlayRoot.isConnected).toBe(true)
    expect(host.actions.getSnapshot()).toHaveLength(1)
  })
})
