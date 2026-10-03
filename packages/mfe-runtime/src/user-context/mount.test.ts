import { describe, expect, it } from 'vitest'
import { createMountContext } from '../mount/mount-context.ts'
import { createMemoryRuntime } from '../testing/memory-runtime.ts'
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
})
