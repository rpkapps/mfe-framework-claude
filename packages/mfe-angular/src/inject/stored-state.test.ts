import { Component, createEnvironmentInjector, runInInjectionContext } from '@angular/core'
import { HOST_SCOPE } from '@company/mfe-core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createHostApplication } from '../__tests__/harness.ts'
import { createWidget } from '../definition.ts'
import { createMfeTestEnvironment, mountWidget } from '../testing/index.ts'
import { injectStoredState } from './stored-state.ts'

const densitySchema = z.enum(['comfortable', 'compact'])

@Component({ selector: 'test-empty', template: '' })
class EmptyComponent {}

const tableWidget = createWidget({
  id: 'orders-table',
  inputs: z.object({}),
  events: {},
  component: EmptyComponent,
})

function injectDensity() {
  return injectStoredState('density', densitySchema, { defaultValue: 'comfortable' })
}

describe('injectStoredState', () => {
  it('stores under the definition inside a mount and under the host scope outside one', async () => {
    const environment = createMfeTestEnvironment()
    const widget = await mountWidget(tableWidget, { environment })
    const appRef = await createHostApplication(environment)

    const mounted = runInInjectionContext(widget.injector, injectDensity)
    const chrome = runInInjectionContext(appRef.injector, injectDensity)
    mounted.set('compact')

    expect(mounted.value()).toBe('compact')
    expect(chrome.value()).toBe('comfortable')
    expect(Object.keys(environment.storageAreas.local.snapshot())).toEqual(['orders-table:density'])

    chrome.set('compact')
    expect(Object.keys(environment.storageAreas.local.snapshot()).sort()).toEqual([
      `${HOST_SCOPE}:density`,
      'orders-table:density',
    ])
    environment.dispose()
  })

  it('follows writes made through another binding of the same key', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)
    const state = runInInjectionContext(appRef.injector, injectDensity)

    const other = environment.runtime.storage.bindHost({
      name: 'density',
      schema: densitySchema,
      defaultValue: 'comfortable' as const,
    })
    other.set('compact')

    expect(state.value()).toBe('compact')
    state.remove()
    expect(other.read()).toBe('comfortable')
    other.release()
    environment.dispose()
  })

  it('releases its binding when the injector that created it is destroyed', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)
    const { storage } = environment.runtime
    const held = storage.bindHost({
      name: 'density',
      schema: densitySchema,
      defaultValue: 'compact' as const,
    })
    const chrome = createEnvironmentInjector([], appRef.injector)
    runInInjectionContext(chrome, () =>
      injectStoredState('density', densitySchema, { defaultValue: 'compact' }),
    )

    chrome.destroy()
    // If the injector released, `held` is now the last binding and dropping it drops the entry,
    // so a different default binds instead of being rejected as a conflicting declaration.
    held.release()

    expect(() =>
      storage
        .bindHost({ name: 'density', schema: densitySchema, defaultValue: 'comfortable' as const })
        .release(),
    ).not.toThrow()
    environment.dispose()
  })

  it('throws, and reports, rather than falling back when the stored value is unreadable', async () => {
    const environment = createMfeTestEnvironment()
    environment.storageAreas.local.setItem(
      `${HOST_SCOPE}:density`,
      JSON.stringify({ v: 1, r: 'browser', d: 'sparse' }),
    )
    const appRef = await createHostApplication(environment)

    expect(() => runInInjectionContext(appRef.injector, injectDensity)).toThrowError(/density/)
    expect(environment.diagnostics.map(({ error }) => error.code)).toContain('storage/failure')
    environment.dispose()
  })
})
