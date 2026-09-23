/**
 * The two Apps the placement scenarios place: `ledger` on React with TanStack Router, and
 * `insights` on Angular with its own router. Each shows the entry its location names under
 * `entries/:entryId`, the base path its host assigned and a link to entry 8, so a scenario reads
 * the same things from either; the Angular one also shows its mount depth and names its
 * breadcrumb.
 */

import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { createApp as createAngularApp, injectMfeMount, mfeRouteData } from '@company/mfe-angular'
import { createApp as createReactApp, useBasePath, type MfeRouterContext } from '@company/mfe-react'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
} from '@tanstack/react-router'
import { createElement as h, useEffect, type ReactNode } from 'react'
import { map } from 'rxjs'

import { applicationCensus } from '../__tests__/harness.ts'

/** How many of the React App's entry pages are mounted right now. */
const ledgerPages = { live: 0 }

const ledgerRoot = createRootRouteWithContext<MfeRouterContext>()({
  component: () => h(Outlet),
})

const ledgerEntry = createRoute({
  getParentRoute: () => ledgerRoot,
  path: '/entries/$entryId',
  component: function LedgerEntry(): ReactNode {
    useEffect(() => {
      ledgerPages.live += 1
      return () => {
        ledgerPages.live -= 1
      }
    }, [])
    // This tree is not the registered one, so the typed accessor resolves to `any`.
    const { entryId } = ledgerEntry.useParams() as unknown as { entryId: string }
    return h(
      'section',
      null,
      h('h1', null, `Ledger entry ${entryId}`),
      h('p', null, `under ${useBasePath()}`),
      h(Link, { to: '/entries/8' }, 'Open entry 8'),
    )
  },
})

export const ledgerApp = createReactApp({
  id: 'ledger',
  version: '1.2.0',
  router: ({ basePath, history, context }) =>
    createRouter({
      routeTree: ledgerRoot.addChildren([ledgerEntry]),
      basepath: basePath,
      history,
      context: { ...context },
    }),
})

/** Every application the Angular App's mounts created and have not destroyed. */
const insightsApplications = applicationCensus()

@Component({
  selector: 'interop-insights-entry',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1>Insights entry {{ entryId() }}</h1>
    <p>under {{ mount.basePath }}</p>
    <p>depth {{ mount.depth }}</p>
    <a routerLink="/entries/8">Open entry 8</a>`,
})
class InsightsEntryComponent {
  readonly entryId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map(params => params.get('entryId'))),
  )
  readonly mount = injectMfeMount()
}

export const insightsApp = createAngularApp({
  id: 'insights',
  version: '3.1.0',
  routes: [
    {
      path: 'entries',
      data: mfeRouteData({ breadcrumb: 'Entries' }),
      children: [{ path: ':entryId', component: InsightsEntryComponent }],
    },
  ],
  providers: [insightsApplications.providers],
})

/** What of each App is alive now: the React App's entry pages, the Angular App's applications. */
export const liveApps = {
  get ledger(): number {
    return ledgerPages.live
  },
  get insights(): number {
    return insightsApplications.live
  },
}
