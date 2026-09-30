import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type * as MfeCore from '@company/mfe-core'
import type { AppMountTarget, WidgetMountTarget } from '@company/mfe-runtime'

// Model the first-loaded shared core from before the handshake existed. The adapter's guard
// must remain usable without any of the newly added exports on the bare package.
vi.mock('@company/mfe-core', async importOriginal => {
  const current = await importOriginal<typeof MfeCore>()
  return Object.fromEntries(
    Object.entries(current).filter(
      ([name]) =>
        ![
          'assertRuntimeCompatibility',
          'isRuntimeRequirement',
          'satisfiesRuntimeRequirement',
          'RUNTIME_API_VERSION',
          'RUNTIME_API_REQUIREMENT',
        ].includes(name),
    ),
  )
})

import { createApp, createWidget } from './definition.ts'

describe('new React adapter against an older shared core and shell', () => {
  it('refuses an app before importing its renderer or invoking authored routing', async () => {
    const router = vi.fn()
    const app = createApp({ id: 'new-app', router })
    const incompleteTarget = { context: { runtime: {} } }
    const target = incompleteTarget as AppMountTarget
    await expect(app.mount(target)).rejects.toMatchObject({
      code: 'config/missing',
      path: ['apiVersion'],
    })
    expect(router).not.toHaveBeenCalled()
  })

  it('refuses a widget before rendering, with the adapter baseline preserved locally', async () => {
    const render = vi.fn(() => null)
    const widget = createWidget({
      id: 'new-widget',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      render,
    })
    expect(widget.requiresRuntime).toBe('>=1.1.0 <2.0.0')
    const incompleteTarget = { context: { runtime: {} } }
    const target = incompleteTarget as WidgetMountTarget
    await expect(widget.mount(target)).rejects.toMatchObject({
      code: 'config/missing',
      path: ['apiVersion'],
    })
    expect(render).not.toHaveBeenCalled()
  })
})
