/**
 * Mounting an App: one Angular application per mount, with the App's routes over a location
 * strategy that reads and writes the host's navigation bridge rather than the browser's history.
 * The router starts its first navigation only once the root view is attached, because an
 * application that is not bootstrapped never runs the router's bootstrap listener. Preloading and
 * in-memory scrolling start only from that listener too, and blocking initial navigation waits on
 * it forever, so `createApp` refuses those features.
 */

import { APP_BASE_HREF, LocationStrategy } from '@angular/common'
import { createComponent } from '@angular/core'
import { provideRouter, Router, withDisabledInitialNavigation } from '@angular/router'
import type { AppMountTarget, MountContext, MountedApp } from '@company/mfe-runtime'

import type { AppDefinition } from '../definition.ts'
import { BoundaryLocationStrategy } from '../routing/boundary-location-strategy.ts'
import { contributeBreadcrumbs } from '../routing/breadcrumbs-from-routes.ts'
import {
  APP_NAVIGATION_BLOCKERS,
  provideMfeNavigationBlockers,
  registerAppNavigationBlocker,
} from '../routing/navigation-blockers.ts'
import {
  provideSettledNavigations,
  reportNavigationFailures,
} from '../routing/navigation-failures.ts'
import { disposedWhileMounting, MountErrorHandler, runMountApplication } from './mount-providers.ts'

/** `Location` strips this prefix from every path the strategy reads, as it would a real base href. */
function baseHrefOf(context: MountContext): string {
  return context.basePath === '' ? '/' : context.basePath
}

export async function mountApp(
  definition: AppDefinition,
  target: AppMountTarget,
): Promise<MountedApp> {
  const { context } = target
  if (context.signal.aborted) throw disposedWhileMounting(context)

  // A bridge of its own, so the other Apps on the page hear where this router takes it.
  const location = new BoundaryLocationStrategy(
    context.runtime.navigator.createBridge(),
    baseHrefOf(context),
  )

  const { dispose, whenStable } = await runMountApplication({
    definition,
    target,
    errors: new MountErrorHandler(context),
    // A router that writes only to the bridge, which the author's providers cannot replace.
    providers: [
      provideRouter(
        definition.routes,
        ...definition.routerFeatures,
        withDisabledInitialNavigation(),
      ),
      provideSettledNavigations(definition.routerFeatures),
      { provide: APP_BASE_HREF, useValue: location.getBaseHref() },
      { provide: LocationStrategy, useValue: location },
      provideMfeNavigationBlockers(),
    ],
    render: (application, hostElement) => {
      const ref = createComponent(definition.component, {
        environmentInjector: application.injector,
        hostElement,
      })
      application.attachView(ref.hostView)
      application.tick()
    },
    start: (_rendered, { injector }) => {
      const router = injector.get(Router)
      // Before the first navigation starts, so its failure fails the mount.
      const stopReportingFailures = reportNavigationFailures(router, context, target.onFailure)
      const stopBlocking = registerAppNavigationBlocker({
        context,
        injector,
        blockers: injector.get(APP_NAVIGATION_BLOCKERS),
      })
      const stopBreadcrumbs = definition.contributesBreadcrumbs
        ? contributeBreadcrumbs(router, context, definition.id)
        : () => undefined

      // Mounted while the page is elsewhere, the App waits for the page to reach its boundary
      // rather than routing a path it does not own.
      if (location.ownsCurrentPath()) router.initialNavigation()
      else router.setUpLocationChangeListener()

      // Registrations first, so a disposed App cannot be asked about a navigation mid-teardown.
      return () => {
        stopBlocking()
        stopBreadcrumbs()
        stopReportingFailures()
      }
    },
    release: () => {
      location.dispose()
    },
  })

  return { dispose, whenStable }
}
