import { afterEach, describe, expect, it } from 'vitest'

import { planContainer } from '../plan.ts'
import { cleanupContainers, createContainer } from '../testing/containers.ts'

afterEach(cleanupContainers)

/** An App whose routes live in `src/app.routes.ts`, the way the generator writes one. */
function appWithRoutes(routes: string, extra: Readonly<Record<string, string>> = {}): string {
  return createContainer({
    'src/mfe.ts': `
import { createApp } from '@company/mfe-angular'

import { routes } from './app.routes'

export const reports = createApp({ id: 'reports', routes })
`,
    'src/app.routes.ts': `
import type { Routes } from '@angular/router'
import { mfeRouteData } from '@company/mfe-angular'

class Page {}

${routes}
`,
    ...extra,
  })
}

function capabilitiesOf(root: string) {
  return planContainer({ containerRoot: root }).capabilities
}

describe('reading capability routes from mfeRouteData', () => {
  it('records a capability route with its literal path, label and icon', () => {
    const root = appWithRoutes(`
export const routes: Routes = [
  { path: '', component: Page },
  {
    path: 'settings',
    component: Page,
    data: mfeRouteData({ capability: 'settings', label: 'Report settings', icon: 'gear' }),
  },
]`)

    expect(capabilitiesOf(root)).toEqual([
      { name: 'settings', label: 'Report settings', icon: 'gear', path: '/settings' },
    ])
  })

  it("joins a nested route's path with every parent's, through inline children", () => {
    const root = appWithRoutes(`
export const routes: Routes = [
  {
    path: 'admin',
    children: [
      { path: '', component: Page },
      { path: 'help', component: Page, data: mfeRouteData({ capability: 'help', label: 'Help' }) },
    ],
  },
]`)

    expect(capabilitiesOf(root)).toEqual([{ name: 'help', label: 'Help', path: '/admin/help' }])
  })

  it('sorts several capabilities by the contract order, so the descriptor is stable', () => {
    const root = appWithRoutes(`
export const routes: Routes = [
  { path: 'notes', component: Page, data: mfeRouteData({ capability: 'releaseNotes', label: 'Notes' }) },
  { path: 'settings', component: Page, data: mfeRouteData({ capability: 'settings', label: 'Settings' }) },
]`)

    expect(capabilitiesOf(root).map(capability => capability.name)).toEqual([
      'settings',
      'releaseNotes',
    ])
  })

  it('follows createApp given the routes array inline in the entry', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createApp, mfeRouteData } from '@company/mfe-angular'

class Page {}

export const reports = createApp({
  id: 'reports',
  routes: [{ path: 'settings', component: Page, data: mfeRouteData({ capability: 'settings', label: 'Settings' }) }],
})
`,
    })

    expect(capabilitiesOf(root)).toEqual([
      { name: 'settings', label: 'Settings', path: '/settings' },
    ])
  })

  it('reads the factory through an alias or a namespace import of the adapter', () => {
    const root = appWithRoutes(
      `
import * as mfe from '@company/mfe-angular'
import { mfeRouteData as routeData } from '@company/mfe-angular'

export const routes: Routes = [
  { path: 'settings', component: Page, data: routeData({ capability: 'settings', label: 'Settings' }) },
  { path: 'help', component: Page, data: mfe.mfeRouteData({ capability: 'help', label: 'Help' }) },
]`,
    )

    expect(capabilitiesOf(root).map(capability => capability.path)).toEqual(['/settings', '/help'])
  })

  it('ignores route data that declares no capability, such as a breadcrumb', () => {
    const root = appWithRoutes(`
export const routes: Routes = [
  { path: 'orders', component: Page, data: mfeRouteData({ breadcrumb: 'Orders' }) },
]`)

    expect(capabilitiesOf(root)).toEqual([])
  })

  it('never reads a test file, which declares fixtures rather than the App', () => {
    const root = appWithRoutes('export const routes: Routes = []', {
      'src/app.routes.spec.ts': `
import { mfeRouteData } from '@company/mfe-angular'
export const fixture = [{ path: 'x', data: mfeRouteData({ capability: 'settings', label: 'X' }) }]
`,
    })

    expect(capabilitiesOf(root)).toEqual([])
  })

  it("ignores a function of the same name that is not the adapter's", () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createApp } from '@company/mfe-angular'

const mfeRouteData = (data: object) => data

class Page {}

export const reports = createApp({
  id: 'reports',
  routes: [{ path: 'settings', component: Page, data: mfeRouteData({ capability: 'settings', label: 'Settings' }) }],
})
`,
    })

    expect(capabilitiesOf(root)).toEqual([])
  })
})

describe('a capability route the build cannot trace', () => {
  it('is refused when its route data is built elsewhere', () => {
    const root = appWithRoutes(`
const settings = { capability: 'settings', label: 'Settings' } as const
export const routes: Routes = [{ path: 'settings', component: Page, data: mfeRouteData(settings) }]`)

    expect(() => capabilitiesOf(root)).toThrowError(
      /reports.*extract a capability route.*mfeRouteData\(\{ … \}\) with an inline object literal/s,
    )
  })

  it('is refused when a path on the way is computed', () => {
    const root = appWithRoutes(`
const base = 'admin'
export const routes: Routes = [
  { path: base, children: [{ path: 'settings', component: Page, data: mfeRouteData({ capability: 'settings', label: 'Settings' }) }] },
]`)

    expect(() => capabilitiesOf(root)).toThrowError(
      /resolve the path of the 'settings' capability route.*string-literal path/s,
    )
  })

  it('is refused when the route sits in an array createApp never receives', () => {
    const root = appWithRoutes(`
const adminRoutes: Routes = [
  { path: 'settings', component: Page, data: mfeRouteData({ capability: 'settings', label: 'Settings' }) },
]
export const routes: Routes = [{ path: 'admin', children: adminRoutes }]`)

    expect(() => capabilitiesOf(root)).toThrowError(
      /routes array createApp receives.*a routes array bound to adminRoutes/s,
    )
  })

  it('is refused when two routes declare the same capability', () => {
    const root = appWithRoutes(`
export const routes: Routes = [
  { path: 'a', component: Page, data: mfeRouteData({ capability: 'settings', label: 'A' }) },
  { path: 'b', component: Page, data: mfeRouteData({ capability: 'settings', label: 'B' }) },
]`)

    expect(() => capabilitiesOf(root)).toThrowError(
      /one route per capability.*'\/a' and '\/b'.*Remove the capability from one of their mfeRouteData calls/s,
    )
  })

  it('is refused in a container that exports Widgets only', () => {
    const root = createContainer({
      'src/mfe.ts': `
import { createWidget } from '@company/mfe-angular'
import { z } from 'zod'

class Panel {}

export const panel = createWidget({ id: 'panel', inputs: z.object({}), events: {}, component: Panel })
`,
      'src/panel.routes.ts': `
import { mfeRouteData } from '@company/mfe-angular'
export const routes = [{ path: 'settings', data: mfeRouteData({ capability: 'settings', label: 'S' }) }]
`,
    })

    expect(() => capabilitiesOf(root)).toThrowError(
      /a capability declared by an App.*Widgets only/s,
    )
  })
})
