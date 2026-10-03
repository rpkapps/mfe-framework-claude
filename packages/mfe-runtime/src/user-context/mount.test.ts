import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createMountContext } from '../mount/mount-context.ts'
import { ShellStateStore } from '../shell-state/shell-state-store.ts'
import { createMemoryRuntime } from '../testing/memory-runtime.ts'
import { createHostUserContext } from './host.ts'
import { prepareUserContextMount } from './mount.ts'

describe('user-context mount declarations', () => {
  it('refuses a widget borrowing its parent app identity', async () => {
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
          { id: 'parent-app', userContext: { schema: z.object({}) } },
          mount.context,
        ),
      ).rejects.toMatchObject({ code: 'user-context/unauthorized-owner' })
    } finally {
      await mount.dispose()
      memory.dispose()
    }
  })

  it('mounts a definition without user context while signed out and never touches persistence', async () => {
    const memory = createMemoryRuntime()
    const hydrate = vi.fn(async () => [])
    const host = createHostUserContext({
      persistence: { adapter: { hydrate, write: vi.fn() } },
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

  it('binds a mount to the user it prepared for', async () => {
    const shellState = new ShellStateStore({
      user: { id: 'one', name: 'One' },
      groups: [],
      theme: 'light',
    })
    const memory = createMemoryRuntime()
    const host = createHostUserContext({
      persistence: {
        adapter: { hydrate: async ids => ids.map(id => ({ id, revision: 0 })), write: vi.fn() },
      },
      shellState,
    })
    const mount = createMountContext({
      runtime: { ...memory.runtime, userContext: host.service },
      definitionId: 'reader',
      kind: 'widget',
      basePath: '/',
    })
    try {
      const context = await prepareUserContextMount(
        { id: 'reader', userContext: { reads: { owner: z.object({}) } } },
        mount.context,
      )
      expect(context.resolveUserContext?.('owner').getSnapshot()).toEqual({})
      shellState.apply({ user: { id: 'two', name: 'Two' } })
      expect(() => context.resolveUserContext?.('other')).toThrow('previous signed-in user')
      expect(() => context.resolveUserContext?.('owner')).toThrow('previous signed-in user')
    } finally {
      await mount.dispose()
      host.dispose()
      memory.dispose()
      shellState.dispose()
    }
  })
})
