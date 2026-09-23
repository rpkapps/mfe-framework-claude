import {
  Component,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
  type EnvironmentInjector,
} from '@angular/core'
import type { BreadcrumbItem } from '@company/mfe-core'
import { describe, expect, it } from 'vitest'

import { createApp } from '../definition.ts'
import { createHostApplication, createMfeTestEnvironment, mountApp } from '../testing/index.ts'
import { injectBreadcrumbs } from './breadcrumbs.ts'

@Component({ selector: 'test-page', template: '' })
class PageComponent {}

const ordersApp = createApp({
  id: 'orders',
  routes: [{ path: 'history', component: PageComponent }],
})

function labels(items: readonly BreadcrumbItem[]): readonly string[] {
  return items.map(item => item.label)
}

function contribute(
  parent: EnvironmentInjector,
  items: () => readonly BreadcrumbItem[],
): EnvironmentInjector {
  const scope = createEnvironmentInjector([], parent)
  runInInjectionContext(scope, () => {
    injectBreadcrumbs(items)
  })
  return scope
}

describe('injectBreadcrumbs', () => {
  it('overrides only the App’s own crumbs inside a mount, and an empty list means no override', async () => {
    const app = await mountApp(ordersApp, {
      basePath: '/orders',
      initialEntries: ['/orders/history'],
    })
    const { breadcrumbs } = app.environment.runtime
    const steps = signal<readonly BreadcrumbItem[]>([])

    const flow = contribute(app.injector, steps)
    await app.whenStable()
    expect(labels(breadcrumbs.getSnapshot())).toEqual(['History'])

    steps.set([{ key: 'review', label: 'Review order' }])
    await app.whenStable()
    expect(labels(breadcrumbs.getSnapshot())).toEqual(['Review order'])

    steps.set([])
    await app.whenStable()
    expect(labels(breadcrumbs.getSnapshot())).toEqual(['History'])

    steps.set([{ key: 'confirm', label: 'Confirm' }])
    await app.whenStable()
    flow.destroy()
    expect(labels(breadcrumbs.getSnapshot())).toEqual(['History'])
  })

  it('composes the host’s own crumbs above a mounted App’s, and removes them with the chrome', async () => {
    const environment = createMfeTestEnvironment({
      definitions: [ordersApp],
      initialEntries: ['/orders/history'],
    })
    const appRef = await createHostApplication(environment)
    const app = await mountApp(ordersApp, { environment, basePath: '/orders' })
    const trail = signal<readonly BreadcrumbItem[]>([{ key: 'home', label: 'Home' }])

    const chrome = contribute(appRef.injector, trail)
    await appRef.whenStable()
    const { breadcrumbs } = environment.runtime
    expect(labels(breadcrumbs.getSnapshot())).toEqual(['Home', 'History'])

    trail.set([{ key: 'workspace', label: 'Workspace' }])
    await appRef.whenStable()
    expect(labels(breadcrumbs.getSnapshot())).toEqual(['Workspace', 'History'])

    chrome.destroy()
    expect(labels(breadcrumbs.getSnapshot())).toEqual(['History'])
    await app.dispose()
    environment.dispose()
  })
})
