import { Component, runInInjectionContext } from '@angular/core'
import { describe, expect, it } from 'vitest'

import { createHostApplication } from '../__tests__/harness.ts'
import { createApp } from '../definition.ts'
import { createMfeTestEnvironment, mountApp } from '../testing/index.ts'
import { injectMfeMount, injectOptionalMfeMount } from './runtime.ts'
import { injectBasePath, injectMfeSignal, injectMfeStorage, injectTelemetry } from './services.ts'
import { injectWidgetEmit } from './widget-emit.ts'

@Component({ selector: 'test-page', template: '' })
class PageComponent {}

const ordersApp = createApp({ id: 'orders', routes: [{ path: '', component: PageComponent }] })

describe('the mount-bound services', () => {
  it('hand out what the mount owns', async () => {
    const app = await mountApp(ordersApp, { basePath: '/orders' })

    const services = runInInjectionContext(app.injector, () => ({
      mount: injectMfeMount(),
      telemetry: injectTelemetry(),
      signal: injectMfeSignal(),
      basePath: injectBasePath(),
      local: injectMfeStorage(),
      session: injectMfeStorage('session'),
    }))

    expect(services.mount.definitionId).toBe('orders')
    expect(services.basePath).toBe('/orders')
    expect(services.telemetry).toBe(services.mount.telemetry)
    expect(services.local).toBe(services.mount.storage.local)
    expect(services.session).toBe(services.mount.storage.session)
    expect(services.signal.aborted).toBe(false)

    await app.dispose()
    expect(services.signal.aborted).toBe(true)
  })

  it('name the call and the fix when used outside any mount', async () => {
    const environment = createMfeTestEnvironment()
    const appRef = await createHostApplication(environment)

    const outside = runInInjectionContext(appRef.injector, () => injectOptionalMfeMount())

    expect(outside).toBeNull()
    expect(() => runInInjectionContext(appRef.injector, () => injectBasePath())).toThrowError(
      /<unmounted> failed to call injectBasePath\(\): .* Move the injectBasePath\(\) call into a component the App or Widget renders\./,
    )
    environment.dispose()
  })

  it('offer a Widget’s emit only inside a Widget', async () => {
    const app = await mountApp(ordersApp, { basePath: '/orders' })

    expect(() => runInInjectionContext(app.injector, () => injectWidgetEmit())).toThrowError(
      /failed to call injectWidgetEmit\(\): expected a component or service created inside a Widget mount/,
    )
  })
})
