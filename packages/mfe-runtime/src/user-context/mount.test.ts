import { describe, expect, it, vi } from 'vitest'
import { createMountContext } from '../mount/mount-context.ts'
import { ShellStateStore } from '../shell-state/shell-state-store.ts'
import { createMemoryRuntime } from '../testing/memory-runtime.ts'
import { createHostUserContext } from './host.ts'
import { prepareUserContextMount } from './mount.ts'

describe('compiled user-context mount declarations', () => {
  it('rejects uncompiled consolidated authoring before mounting', async () => {
    const memory = createMemoryRuntime()
    const mount = createMountContext({
      runtime: memory.runtime,
      definitionId: 'widget-owner',
      kind: 'widget',
      basePath: '/',
    })
    try {
      await expect(
        prepareUserContextMount(
          { id: 'widget-owner', userContext: { schema: {}, reads: {} } },
          mount.context,
        ),
      ).rejects.toMatchObject({ code: 'user-context/unsupported-contract' })
    } finally {
      await mount.dispose()
      memory.dispose()
    }
  })

  it.each(['definition', 'requirements'])(
    'refuses a widget borrowing its parent app %s identity',
    async field => {
      const memory = createMemoryRuntime()
      const mount = createMountContext({
        runtime: memory.runtime,
        definitionId: 'widget-owner',
        kind: 'widget',
        basePath: '/',
      })
      try {
        await expect(
          prepareUserContextMount(
            {
              id: field === 'definition' ? 'parent-app' : 'widget-owner',
              __userContext: { protocolVersion: 1, ownerId: 'parent-app', contracts: [] },
            },
            mount.context,
          ),
        ).rejects.toMatchObject({ code: 'user-context/unauthorized-owner' })
      } finally {
        await mount.dispose()
        memory.dispose()
      }
    },
  )

  it('mounts a definition without a contract while signed out and never touches persistence', async () => {
    const memory = createMemoryRuntime()
    const hydrate = vi.fn(async () => [])
    const host = createHostUserContext({
      persistence: { adapter: { hydrate, write: vi.fn() } },
      registry: memory.runtime.registry,
      shellState: new ShellStateStore({ user: null, groups: [], theme: 'light' }),
    })
    const mount = createMountContext({
      runtime: { ...memory.runtime, userContext: host.service },
      definitionId: 'sign-in',
      kind: 'app',
      basePath: '/',
    })
    try {
      const context = await prepareUserContextMount({ id: 'sign-in' }, mount.context)
      expect(context.resolveUserContext).toBeUndefined()
      expect((await context.userContext?.set('units', 'metric'))?.ok).toBe(false)
      expect(hydrate).not.toHaveBeenCalled()
    } finally {
      await mount.dispose()
      host.dispose()
      memory.dispose()
    }
  })
})
