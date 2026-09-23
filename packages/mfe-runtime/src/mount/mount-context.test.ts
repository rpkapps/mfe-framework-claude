/**
 * A mount context is everything one mount owns: it is scoped to its definition, isolated from a
 * second mount of the same definition, and torn down in an order a palette can never observe
 * half-way through.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createMemoryRuntime, type MemoryRuntime } from '../testing/memory-runtime.ts'
import { createMountContext, createMountToken } from './mount-context.ts'
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

  it('stamps the scope root it is given with its definition, its own token and its kind', () => {
    const scopeRoot = document.createElement('div')

    const { context } = createMountContext({
      runtime: runtime(),
      definitionId: 'alert-panel',
      kind: 'widget',
      scopeRoot,
    })

    expect(context.scopeRoot).toBe(scopeRoot)
    expect(scopeRoot.getAttribute(SCOPE_ATTRIBUTE)).toBe('alert-panel')
    expect(scopeRoot.getAttribute(MOUNT_ATTRIBUTE)).toBe(context.mountToken)
    expect(scopeRoot.getAttribute(KIND_ATTRIBUTE)).toBe('widget')
    expect(scopeRoot.style.display).toBe('contents')
  })

  it('carries a detached scope root when it is given none', () => {
    const { context } = createMountContext({
      runtime: runtime(),
      definitionId: 'reports',
      kind: 'app',
    })

    expect(context.scopeRoot.getAttribute(MOUNT_ATTRIBUTE)).toBe(context.mountToken)
    expect(context.scopeRoot.isConnected).toBe(false)
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
  it('aborts the signal and removes the overlay root', async () => {
    const handle = createMountContext({ runtime: runtime(), definitionId: 'reports', kind: 'app' })

    await handle.dispose()

    expect(handle.context.signal.aborted).toBe(true)
    expect(handle.context.overlayRoot.isConnected).toBe(false)
  })

  /** Anything listening for the abort must find the mount already gone from the palette. */
  it('removes the mount’s commands and blockers before it aborts', async () => {
    const host = runtime()
    const handle = createMountContext({ runtime: host, definitionId: 'reports', kind: 'app' })
    const { mountToken } = handle.context
    host.commands.register(handle.context, {
      name: 'refresh',
      label: 'Refresh',
      execute: () => undefined,
    })
    host.navigator.registerBlocker(mountToken, {
      depth: 1,
      shouldBlock: () => true,
      confirm: () => Promise.resolve('proceed'),
    })

    const atAbort: { commands?: number; blockers?: number } = {}
    handle.context.signal.addEventListener('abort', () => {
      atAbort.commands = host.commands.getSnapshot().length
      atAbort.blockers = host.navigator.blockerCount
    })

    await handle.dispose()

    expect(atAbort).toEqual({ commands: 0, blockers: 0 })
  })

  it('leaves another mount of the same definition untouched', async () => {
    const host = runtime()
    const first = createMountContext({ runtime: host, definitionId: 'reports', kind: 'app' })
    const second = createMountContext({ runtime: host, definitionId: 'reports', kind: 'app' })
    host.commands.register(second.context, {
      name: 'refresh',
      label: 'Refresh',
      execute: () => undefined,
    })

    await first.dispose()

    expect(second.context.signal.aborted).toBe(false)
    expect(second.context.overlayRoot.isConnected).toBe(true)
    expect(host.commands.getSnapshot()).toHaveLength(1)
  })
})
