import { Component } from '@angular/core'
import type * as MfeCore from '@company/mfe-core'
import type { AppMountTarget, WidgetMountTarget } from '@company/mfe-runtime'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

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
          'LEGACY_RUNTIME_API_VERSION',
          'LEGACY_RUNTIME_API_REQUIREMENT',
        ].includes(name),
    ),
  )
})

import { createApp, createWidget } from './definition.ts'

@Component({ standalone: true, template: '' })
class EmptyComponent {}

describe('new Angular adapter against an older shared core and shell', () => {
  it('refuses an app before constructing its application', async () => {
    const app = createApp({ id: 'new-app', routes: [] })
    const legacyTarget = { context: { runtime: {} } }
    const target = legacyTarget as AppMountTarget
    await expect(app.mount(target)).rejects.toMatchObject({ code: 'contract/runtime-incompatible' })
  })

  it('refuses a widget with a locally preserved adapter baseline', async () => {
    const widget = createWidget({
      id: 'new-widget',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      component: EmptyComponent,
    })
    expect(widget.requiresRuntime).toBe('>=1.1.0 <2.0.0')
    const legacyTarget = { context: { runtime: {} } }
    const target = legacyTarget as WidgetMountTarget
    await expect(widget.mount(target)).rejects.toMatchObject({
      code: 'contract/runtime-incompatible',
    })
  })
})
