import { Component, createEnvironmentInjector, runInInjectionContext, signal } from '@angular/core'
import { allow, deny } from '@company/mfe-core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createHostApplication } from '../__tests__/harness.ts'
import { createWidget } from '../definition.ts'
import { createMfeTestEnvironment, mountWidget } from '../testing/index.ts'
import { injectCommand } from './command.ts'

@Component({ selector: 'test-empty', template: '' })
class EmptyComponent {}

const ordersWidget = createWidget({
  id: 'orders',
  inputs: z.object({}),
  events: {},
  component: EmptyComponent,
})

describe('injectCommand', () => {
  it('registers in the host scope outside a mount and runs through the palette’s path', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)
    const execute = vi.fn()

    runInInjectionContext(appRef.injector, () => {
      injectCommand({ name: 'refresh', label: 'Refresh', execute })
    })
    const result = await environment.runtime.commands.execute('@host:refresh')

    expect(environment.runtime.commands.getSnapshot().map(entry => entry.id)).toEqual([
      '@host:refresh',
    ])
    expect(result).toEqual({ status: 'executed' })
    expect(execute).toHaveBeenCalledOnce()
    environment.dispose()
  })

  it('registers under the definition inside a mount', async () => {
    const widget = await mountWidget(ordersWidget)

    runInInjectionContext(widget.injector, () => {
      injectCommand({ name: 'export', label: 'Export', execute: () => undefined })
    })

    expect(widget.environment.runtime.commands.getSnapshot().map(entry => entry.id)).toEqual([
      'orders:export',
    ])
  })

  it('republishes its decision when a signal the factory reads changes', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)
    const canExport = signal(false)

    runInInjectionContext(appRef.injector, () => {
      injectCommand(() => ({
        name: 'export',
        label: 'Export',
        execute: () => undefined,
        canExecute: () => (canExport() ? allow() : deny('Nothing selected')),
      }))
    })
    await appRef.whenStable()
    const { commands } = environment.runtime
    expect(commands.getSnapshot()[0]?.decision).toEqual({
      allowed: false,
      reason: 'Nothing selected',
    })

    canExport.set(true)
    await appRef.whenStable()

    expect(commands.getSnapshot()[0]?.decision).toEqual({ allowed: true })
    environment.dispose()
  })

  it('unregisters when the injector that registered it is destroyed', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)
    const chrome = createEnvironmentInjector([], appRef.injector)

    runInInjectionContext(chrome, () => {
      injectCommand({ name: 'refresh', label: 'Refresh', execute: () => undefined })
    })
    chrome.destroy()

    expect(environment.runtime.commands.size).toBe(0)
    environment.dispose()
  })
})
