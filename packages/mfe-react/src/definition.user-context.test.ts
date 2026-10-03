import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import { createApp, createWidget, type AppOptions } from './definition.ts'

const userContext = {
  schema: z.object({ collapsed: z.boolean().default(false) }),
  reads: {
    preferences: z.object({ appearance: z.object({ theme: z.string() }) }),
  },
}

describe('consolidated React user-context declarations', () => {
  it('accepts owned and nested foreign declarations on apps and widgets', () => {
    const app = createApp({ id: 'app-owner', router: vi.fn(), userContext })
    const widget = createWidget({
      id: 'widget-owner',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      render: () => null,
      userContext,
    })
    expect(app.userContext).toBe(userContext)
    expect(widget.userContext).toBe(userContext)
    expectTypeOf<AppOptions>().not.toHaveProperty('userContextSchema')
    expectTypeOf<AppOptions>().not.toHaveProperty('userContextReads')
  })
})
