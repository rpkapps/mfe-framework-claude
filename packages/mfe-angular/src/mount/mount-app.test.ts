import { APP_BASE_HREF, Location } from '@angular/common'
import { Component, inject, Input } from '@angular/core'
import {
  ActivatedRoute,
  Router,
  RouterOutlet,
  type CanDeactivateFn,
  type RouterStateSnapshot,
  type Routes,
  withComponentInputBinding,
} from '@angular/router'
import { createNavigationIntent, parseBoundaryLocation } from '@company/mfe-runtime'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createApp } from '../definition.ts'
import { injectAction } from '../inject/action.ts'
import { injectNavigationBlock, type NavigationBlock } from '../inject/navigation-block.ts'
import { injectTheme } from '../inject/shell-state.ts'
import { injectStoredState } from '../inject/stored-state.ts'
import { mfeRouteData } from '../routing/route-data.ts'
import { createMfeTestEnvironment, mountApp, type MountedTestDefinition } from '../testing/index.ts'

@Component({ selector: 'test-overview', template: '<h1>overview</h1>' })
class OverviewComponent {}

@Component({ selector: 'test-report', template: '<h1>report {{ reportId }}</h1>' })
class ReportComponent {
  readonly reportId = inject(ActivatedRoute).snapshot.paramMap.get('reportId')
}

@Component({ selector: 'test-editor', template: '<h1>editor</h1>' })
class EditorComponent {
  dirty = true
}

const routes: Routes = [
  { path: '', component: OverviewComponent },
  { path: 'reports/:reportId', component: ReportComponent },
]

const reportsApp = createApp({ id: 'reports', version: '2.0.0', routes })

function heading(mounted: MountedTestDefinition): string | null | undefined {
  return mounted.element.querySelector('h1')?.textContent
}

function intentTo(mounted: MountedTestDefinition, to: string, basePath = '/reports') {
  const { navigator } = mounted.environment.runtime
  return createNavigationIntent(navigator.read(), parseBoundaryLocation(to), basePath)
}

describe('mounting an App', () => {
  it('renders the route below its boundary that the current location names', async () => {
    const app = await mountApp(reportsApp, {
      basePath: '/reports',
      initialEntries: ['/reports/reports/42'],
    })

    expect(heading(app)).toBe('report 42')
    expect(app.element.getAttribute('data-mfe-kind')).toBe('app')
  })

  it('navigates through the host’s bridge and never through the browser’s history', async () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    const before = window.location.href
    const app = await mountApp(reportsApp, { basePath: '/reports' })

    await app.injector.get(Router).navigateByUrl('/reports/7')
    await app.whenStable()

    expect(heading(app)).toBe('report 7')
    expect(app.environment.navigation.entries).toEqual(['/reports', '/reports/reports/7'])
    expect(app.injector.get(Location).path()).toBe('/reports/7')
    expect(window.location.href).toBe(before)
    expect(pushState).not.toHaveBeenCalled()
    pushState.mockRestore()
  })

  it('hears a browser back the host’s bridge reports', async () => {
    const app = await mountApp(reportsApp, { basePath: '/reports' })
    await app.injector.get(Router).navigateByUrl('/reports/7')
    await app.whenStable()

    app.environment.navigation.back()

    // The router defers a popstate navigation by a task of its own.
    await vi.waitFor(() => {
      expect(heading(app)).toBe('overview')
    })
  })

  it('gives Angular the boundary as its base href, so router paths stay relative to it', async () => {
    const app = await mountApp(reportsApp, {
      basePath: '/reports',
      initialEntries: ['/reports/reports/42'],
    })

    expect(app.injector.get(APP_BASE_HREF)).toBe('/reports')
    expect(app.injector.get(Location).path()).toBe('/reports/42')
    expect(app.injector.get(Location).prepareExternalUrl('/reports/1')).toBe('/reports/reports/1')
  })

  it('waits while the page is outside its boundary, and routes once the page arrives', async () => {
    const app = await mountApp(reportsApp, {
      basePath: '/reports',
      initialEntries: ['/reports/reports/3', '/elsewhere'],
    })
    expect(heading(app)).toBeUndefined()

    app.environment.navigation.back()

    await vi.waitFor(() => {
      expect(heading(app)).toBe('report 3')
    })
  })

  it('applies the App’s router features', async () => {
    @Component({ selector: 'test-bound', template: '<h1>bound {{ reportId }}</h1>' })
    class BoundReportComponent {
      @Input() reportId = ''
    }
    const bound = createApp({
      id: 'bound',
      routes: [{ path: ':reportId', component: BoundReportComponent }],
      routerFeatures: [withComponentInputBinding()],
    })

    const app = await mountApp(bound, { basePath: '/bound', initialEntries: ['/bound/9'] })

    expect(heading(app)).toBe('bound 9')
  })

  it('renders an App’s own root component around its routes', async () => {
    @Component({
      selector: 'test-shell',
      imports: [RouterOutlet],
      template: '<nav>menu</nav><router-outlet />',
    })
    class ShellComponent {}
    const framed = createApp({ id: 'framed', routes, component: ShellComponent })

    const app = await mountApp(framed, { basePath: '/framed' })

    expect(app.element.querySelector('nav')?.textContent).toBe('menu')
    expect(heading(app)).toBe('overview')
  })

  it('leaves the element empty and every registration gone once disposed', async () => {
    const app = await mountApp(reportsApp, { basePath: '/reports' })
    const { runtime } = app.environment

    await app.dispose()

    expect(app.element.isConnected).toBe(false)
    expect(app.element.querySelector('h1')).toBeNull()
    expect(runtime.navigator.blockerCount).toBe(0)
    expect(runtime.breadcrumbs.contributionCount).toBe(0)
  })

  it('gives two mounts of one App their own router and base path', async () => {
    const environment = createMfeTestEnvironment({
      definitions: [reportsApp],
      initialEntries: ['/left/reports/1'],
    })
    const left = await mountApp(reportsApp, { environment, basePath: '/left' })
    const right = await mountApp(reportsApp, { environment, basePath: '/right' })

    expect(left.injector.get(Router)).not.toBe(right.injector.get(Router))
    expect(heading(left)).toBe('report 1')
    // The page is inside the other boundary, so this App waits rather than routing it.
    expect(heading(right)).toBeUndefined()

    await left.dispose()
    await right.injector.get(Router).navigateByUrl('/reports/2')
    await right.whenStable()

    expect(heading(right)).toBe('report 2')
    expect(environment.navigation.entries.at(-1)).toBe('/right/reports/2')
    await right.dispose()
    environment.dispose()
  })

  it('leaves nothing behind after mounting and disposing, whatever the App registered', async () => {
    @Component({ selector: 'test-busy', template: '<h1>{{ theme() }}</h1>' })
    class BusyComponent {
      readonly theme = injectTheme()
      constructor() {
        injectAction({ name: 'refresh', label: 'Refresh', execute: () => undefined })
        injectNavigationBlock(false)
        injectStoredState('density', z.enum(['compact', 'comfortable']), {
          defaultValue: 'compact',
        })
      }
    }
    const busyApp = createApp({ id: 'busy', routes: [{ path: '', component: BusyComponent }] })
    const environment = createMfeTestEnvironment({
      definitions: [busyApp],
      initialEntries: ['/busy'],
    })
    const { runtime } = environment

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const app = await mountApp(busyApp, { environment, basePath: '/busy' })
      expect(heading(app)).toBe('light')
      await app.dispose()
    }

    expect(runtime.actions.size).toBe(0)
    expect(runtime.navigator.blockerCount).toBe(0)
    expect(runtime.breadcrumbs.contributionCount).toBe(0)
    expect(runtime.shellState.fieldListenerCount('theme')).toBe(0)
    expect(document.querySelectorAll('[data-mfe-overlay-root]')).toHaveLength(0)
    expect(document.body.childElementCount).toBe(0)
    environment.dispose()
  })
})

describe('an App’s breadcrumbs', () => {
  @Component({ selector: 'test-settings', template: '<h1>settings</h1>' })
  class SettingsComponent {}

  const crumbRoutes: Routes = [
    { path: '', component: OverviewComponent },
    {
      path: 'asset-reports',
      data: mfeRouteData({ breadcrumb: 'Asset reports' }),
      children: [
        { path: '', component: OverviewComponent },
        { path: ':reportId', component: ReportComponent },
      ],
    },
    { path: 'hidden', component: SettingsComponent, data: mfeRouteData({ breadcrumb: false }) },
    { path: 'titled', title: 'A titled page', component: SettingsComponent },
    { path: 'daily-summary', component: SettingsComponent },
    { path: 'items/:id', component: ReportComponent },
  ]
  const crumbsApp = createApp({ id: 'crumbs', routes: crumbRoutes })

  async function trailAt(path: string): Promise<readonly unknown[]> {
    const app = await mountApp(crumbsApp, {
      basePath: '/crumbs',
      initialEntries: [`/crumbs${path}`],
    })
    return app.environment.runtime.breadcrumbs.getSnapshot()
  }

  it('names each level from its route data, its title or its path, deepest current', async () => {
    expect(await trailAt('/asset-reports/42')).toEqual([
      { key: '/crumbs/asset-reports', label: 'Asset reports', href: '/crumbs/asset-reports' },
      {
        key: '/crumbs/asset-reports/42',
        label: '42',
        href: '/crumbs/asset-reports/42',
        current: true,
      },
    ])
    expect(await trailAt('/titled')).toEqual([
      { key: '/crumbs/titled', label: 'A titled page', href: '/crumbs/titled', current: true },
    ])
    expect(await trailAt('/daily-summary')).toEqual([
      {
        key: '/crumbs/daily-summary',
        label: 'Daily summary',
        href: '/crumbs/daily-summary',
        current: true,
      },
    ])
  })

  it('leaves out a route that opts out, a generic id and the empty index path', async () => {
    expect(await trailAt('/hidden')).toEqual([])
    expect(await trailAt('/items/9')).toEqual([])
    expect(await trailAt('')).toEqual([])
  })

  it('clears an override a flow installed once the App navigates to another path', async () => {
    const app = await mountApp(crumbsApp, {
      basePath: '/crumbs',
      initialEntries: ['/crumbs/titled'],
    })
    const { breadcrumbs } = app.environment.runtime
    const [mountToken] = [...document.querySelectorAll('[data-mfe-mount]')].map(element =>
      element.getAttribute('data-mfe-mount'),
    )
    breadcrumbs.setOverride(mountToken ?? '', [{ key: 'step', label: 'Step 2' }], 'flow')
    expect(breadcrumbs.getSnapshot().map(item => item.label)).toEqual(['Step 2'])

    await app.injector.get(Router).navigateByUrl('/daily-summary')
    await app.whenStable()

    expect(breadcrumbs.getSnapshot().map(item => item.label)).toEqual(['Daily summary'])
  })

  it('contributes nothing for an App that opted out', async () => {
    const quiet = createApp({ id: 'quiet', routes: crumbRoutes, breadcrumbs: false })

    const app = await mountApp(quiet, { basePath: '/quiet', initialEntries: ['/quiet/titled'] })

    expect(app.environment.runtime.breadcrumbs.contributionCount).toBe(0)
  })
})

describe('an App’s guards and the host’s navigations', () => {
  let answer: ((allowed: boolean | ReturnType<Router['parseUrl']>) => void) | null = null
  const asked: { component: unknown; nextUrl: string }[] = []

  const confirmLeave: CanDeactivateFn<EditorComponent> = (
    component,
    _route,
    _current,
    next: RouterStateSnapshot,
  ) => {
    asked.push({ component, nextUrl: next.url })
    return new Promise(resolve => {
      answer = resolve
    })
  }

  const guardedApp = createApp({
    id: 'editor',
    routes: [
      { path: '', component: OverviewComponent },
      { path: 'edit', component: EditorComponent, canDeactivate: [confirmLeave] },
    ],
  })

  async function mountEditing(): Promise<MountedTestDefinition> {
    answer = null
    asked.length = 0
    return await mountApp(guardedApp, { basePath: '/editor', initialEntries: ['/editor/edit'] })
  }

  it('holds a navigation that leaves the App until its guard answers, then lets it through', async () => {
    const app = await mountEditing()
    const commit = vi.fn()

    const outcome = app.environment.runtime.navigator.requestNavigation(
      intentTo(app, '/elsewhere', '/editor'),
      commit,
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(commit).not.toHaveBeenCalled()
    expect(asked).toHaveLength(1)
    expect(asked[0]?.component).toBeInstanceOf(EditorComponent)
    expect(asked[0]?.nextUrl).toBe('/elsewhere')

    answer?.(true)

    await expect(outcome).resolves.toBe('proceeded')
    expect(commit).toHaveBeenCalledOnce()
  })

  it('keeps the host where it is when the guard refuses', async () => {
    const app = await mountEditing()
    const commit = vi.fn()

    const outcome = app.environment.runtime.navigator.requestNavigation(
      intentTo(app, '/elsewhere', '/editor'),
      commit,
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    answer?.(false)

    await expect(outcome).resolves.toBe('blocked')
    expect(commit).not.toHaveBeenCalled()
  })

  it('sends the App to a guard’s redirect instead of letting the host leave', async () => {
    const app = await mountEditing()
    const router = app.injector.get(Router)

    const outcome = app.environment.runtime.navigator.requestNavigation(
      intentTo(app, '/elsewhere', '/editor'),
      () => undefined,
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    answer?.(router.parseUrl('/'))

    await expect(outcome).resolves.toBe('blocked')
    // The redirect leaves the guarded route too, so the router asks the guard once more.
    await vi.waitFor(() => {
      expect(asked).toHaveLength(2)
    })
    expect(asked[1]?.nextUrl).toBe('/')
    answer?.(true)
    await vi.waitFor(() => {
      expect(heading(app)).toBe('overview')
    })
  })

  it('leaves a navigation inside the App to the App’s own router', async () => {
    const app = await mountEditing()
    const commit = vi.fn()

    const outcome = await app.environment.runtime.navigator.requestNavigation(
      intentTo(app, '/editor', '/editor'),
      commit,
    )

    expect(outcome).toBe('proceeded')
    expect(asked).toHaveLength(0)
  })

  it('never strands the host when the App is disposed mid-negotiation', async () => {
    const app = await mountEditing()
    const commit = vi.fn()

    const outcome = app.environment.runtime.navigator.requestNavigation(
      intentTo(app, '/elsewhere', '/editor'),
      commit,
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    await app.dispose()

    await expect(outcome).resolves.toBe('proceeded')
    expect(commit).toHaveBeenCalledOnce()
  })

  it('asks the App’s injectNavigationBlock blockers through the one delegate, after its guards', async () => {
    const captured: { block: NavigationBlock | null } = { block: null }

    @Component({ selector: 'test-draft', template: '<h1>draft</h1>' })
    class DraftComponent {
      constructor() {
        captured.block = injectNavigationBlock(intent => intent.leavesBoundary)
      }
    }
    const draftApp = createApp({ id: 'drafts', routes: [{ path: '', component: DraftComponent }] })
    const app = await mountApp(draftApp, { basePath: '/drafts' })
    const { navigator } = app.environment.runtime
    expect(navigator.blockerCount).toBe(1)

    const outcome = navigator.requestNavigation(
      intentTo(app, '/elsewhere', '/drafts'),
      () => undefined,
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(captured.block?.pending()?.to.pathname).toBe('/elsewhere')

    captured.block?.stay()

    await expect(outcome).resolves.toBe('blocked')
    expect(captured.block?.pending()).toBeNull()
  })
})
