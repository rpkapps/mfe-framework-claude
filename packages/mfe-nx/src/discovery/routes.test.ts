import { afterEach, describe, expect, it } from 'vitest'

import { planContainer } from '../plan.ts'
import { cleanupContainers, createContainer } from '../testing/containers.ts'

afterEach(cleanupContainers)

/** An App whose routes live in `src/app.routes.ts`, the way the generator writes one. */
function routesOf(routes: string) {
  const root = createContainer({
    'src/mfe.ts': `
import { createApp } from '@company/mfe-angular'

import { routes } from './app.routes'

export const reports = createApp({ id: 'reports', routes })
`,
    'src/app.routes.ts': `
import type { Routes } from '@angular/router'

class Page {}

${routes}
`,
  })
  return planContainer({ containerRoot: root }).routes
}

describe('reading an Angular App’s routes', () => {
  it('publishes every route with a component, joining nested paths through inline children', () => {
    expect(
      routesOf(`
export const routes: Routes = [
  { path: '', component: Page },
  { path: 'inspections/:inspectionId', component: Page },
  {
    path: 'sites',
    children: [
      { path: '', component: Page },
      { path: ':siteId', loadComponent: () => import('./site').then(m => m.Site) },
    ],
  },
  { path: 'admin', loadChildren: () => import('./admin').then(m => m.routes) },
]`),
    ).toEqual([
      { path: '/' },
      { path: '/admin' },
      { path: '/inspections/:inspectionId' },
      { path: '/sites' },
      { path: '/sites/:siteId' },
    ])
  })

  it('leaves out redirects, the catch-all and a route whose path is computed', () => {
    expect(
      routesOf(`
const base = 'dynamic'
export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'home', component: Page },
  { path: base, component: Page },
  { path: '**', component: Page },
]`),
    ).toEqual([{ path: '/home' }])
  })

  it('leaves out a matcher route and a named outlet’s, which a path alone does not reach', () => {
    expect(
      routesOf(`
const byExtension = () => null
export const routes: Routes = [
  {
    path: 'wells',
    children: [
      { path: '', component: Page },
      { matcher: byExtension, component: Page },
      { path: 'map', outlet: 'side', component: Page },
      { path: 'list', outlet: 'primary', component: Page },
    ],
  },
]`),
    ).toEqual([{ path: '/wells' }, { path: '/wells/list' }])
  })

  it('publishes nothing when the routes array cannot be followed', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createApp } from '@company/mfe-angular'
import { routes } from '@acme/routes'

export const reports = createApp({ id: 'reports', routes })
`,
    })

    expect(planContainer({ containerRoot: root }).routes).toEqual([])
  })
})
