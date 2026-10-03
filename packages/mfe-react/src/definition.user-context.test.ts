import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import type { UserContextRequirements } from '@company/mfe-core/user-context'
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
    expect(app.__userContext).toBeUndefined()
    expect(widget.__userContext).toBeUndefined()
    expectTypeOf<AppOptions>().not.toHaveProperty('userContextSchema')
    expectTypeOf<AppOptions>().not.toHaveProperty('userContextReads')
  })

  it('keeps generated widget ownership separate from the parent app and author declaration', () => {
    const requirements: UserContextRequirements = {
      protocolVersion: 1,
      ownerId: 'widget-owner',
      contracts: [],
    }
    const widget = createWidget({
      id: 'widget-owner',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      render: () => null,
      __userContext: requirements,
    })
    expect(widget.id).toBe(requirements.ownerId)
    expect(widget.__userContext).toBe(requirements)
    expect(widget).not.toHaveProperty('userContext')
  })
})
