import { Component, createEnvironmentInjector, runInInjectionContext, signal } from '@angular/core'
import { allow, deny } from '@company/mfe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget } from '../definition.ts'
import {
  createHostApplication,
  createMfeTestEnvironment,
  mountApp,
  mountWidget,
  type MountedTestDefinition,
} from '../testing/index.ts'
import { injectAction } from './action.ts'

@Component({ selector: 'test-empty', template: '' })
class EmptyComponent {}

const reportsApp = createApp({
  id: 'reports',
  routes: [{ path: '**', component: EmptyComponent }],
})

const ordersWidget = createWidget({
  id: 'orders',
  inputs: z.object({}),
  events: {},
  component: EmptyComponent,
})

describe('injectAction', () => {
  it('registers in the host scope outside a mount and runs through the palette’s path', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)
    const execute = vi.fn()

    runInInjectionContext(appRef.injector, () => {
      injectAction({ name: 'refresh', label: 'Refresh', execute })
    })
    const result = await environment.runtime.actions.execute('@host:refresh')

    expect(environment.runtime.actions.getSnapshot().map(entry => entry.id)).toEqual([
      '@host:refresh',
    ])
    expect(result).toEqual({ status: 'executed' })
    expect(execute).toHaveBeenCalledOnce()
    environment.dispose()
  })

  it('registers under the definition inside a mount', async () => {
    const widget = await mountWidget(ordersWidget)

    runInInjectionContext(widget.injector, () => {
      injectAction({ name: 'export', label: 'Export', execute: () => undefined })
    })

    expect(widget.environment.runtime.actions.getSnapshot().map(entry => entry.id)).toEqual([
      'orders:export',
    ])
  })

  it('republishes its decision when a signal the factory reads changes', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)
    const canExport = signal(false)

    runInInjectionContext(appRef.injector, () => {
      injectAction(() => ({
        name: 'export',
        label: 'Export',
        execute: () => undefined,
        canExecute: () => (canExport() ? allow() : deny('Nothing selected')),
      }))
    })
    await appRef.whenStable()
    const { actions } = environment.runtime
    expect(actions.getSnapshot()[0]?.decision).toEqual({
      allowed: false,
      reason: 'Nothing selected',
    })

    canExport.set(true)
    await appRef.whenStable()

    expect(actions.getSnapshot()[0]?.decision).toEqual({ allowed: true })
    environment.dispose()
  })

  /** The registry runs after every change; asking twice per change doubles the work for nothing. */
  it('runs the factory and canExecute once for each change of what they read', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)
    const canExport = signal(false)
    const calls = { factory: 0, canExecute: 0 }

    runInInjectionContext(appRef.injector, () => {
      injectAction(() => {
        calls.factory += 1
        return {
          name: 'export',
          label: 'Export',
          execute: () => undefined,
          canExecute: () => {
            calls.canExecute += 1
            return canExport() ? allow() : deny('Nothing selected')
          },
        }
      })
    })
    await appRef.whenStable()
    const settled = { ...calls }

    canExport.set(true)
    await appRef.whenStable()

    expect(calls).toEqual({ factory: settled.factory + 1, canExecute: settled.canExecute + 1 })
    expect(environment.runtime.actions.getSnapshot()[0]?.decision).toEqual({ allowed: true })

    // What `execute` asks is still asked afresh, never answered from an earlier change.
    canExport.set(false)
    const result = await environment.runtime.actions.execute('@host:export')
    expect(result).toMatchObject({ status: 'denied' })
    environment.dispose()
  })

  it('unregisters when the injector that registered it is destroyed', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)
    const chrome = createEnvironmentInjector([], appRef.injector)

    runInInjectionContext(chrome, () => {
      injectAction({ name: 'refresh', label: 'Refresh', execute: () => undefined })
    })
    chrome.destroy()

    expect(environment.runtime.actions.size).toBe(0)
    environment.dispose()
  })
})

describe('injectAction with a shortcut', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function press(init: KeyboardEventInit & { key: string }, target: MountedTestDefinition) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    return target.environment.runtime.actions.handleKeyDown(event)
  }

  it('passes the shortcut through, and the host’s key press runs the App’s action', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    const app = await mountApp(reportsApp, { basePath: '/reports' })
    const execute = vi.fn()

    runInInjectionContext(app.injector, () => {
      injectAction({ name: 'export', label: 'Export', shortcut: 'Mod+E', execute })
    })

    expect(app.environment.runtime.actions.getSnapshot()).toMatchObject([
      { id: 'reports:export', shortcut: 'mod+e' },
    ])
    expect(press({ key: 'e', ctrlKey: true }, app).status).toBe('matched')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('republishes a shortcut a factory derives from a signal', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)
    const keys = signal('g r')

    runInInjectionContext(appRef.injector, () => {
      injectAction(() => ({
        name: 'open',
        label: 'Open',
        shortcut: keys(),
        execute: () => undefined,
      }))
    })
    await appRef.whenStable()
    keys.set('g o')
    await appRef.whenStable()

    expect(environment.runtime.actions.getSnapshot()[0]?.shortcut).toBe('g o')
    environment.dispose()
  })

  it('keeps a Widget’s action but not its shortcut', async () => {
    const widget = await mountWidget(ordersWidget)

    runInInjectionContext(widget.injector, () => {
      injectAction({
        name: 'export',
        label: 'Export',
        shortcut: 'mod+e',
        execute: () => undefined,
      })
    })

    expect(widget.environment.runtime.actions.getSnapshot()[0]).not.toHaveProperty('shortcut')
    expect(widget.environment.diagnostics.map(record => record.error.message).join('\n')).toContain(
      'a shortcut from a Widget',
    )
  })
})
