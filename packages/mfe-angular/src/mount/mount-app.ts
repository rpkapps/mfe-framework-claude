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

  let generation = 0
  let disposed = false
  let mounted = false
  let controller: AbortController | undefined
  let application: Required<MountedApp> | undefined
  let mounting: Promise<Required<MountedApp>>

  const start = (): void => {
    const attempt = ++generation
    // Disposal removes the old view synchronously, before the store notifies UI subscribers.
    controller?.abort()
    if (disposed || attempt !== generation) return
    application = undefined
    controller = new AbortController()
    // Storage, scope roots and mount identity survive; only this application's work is retired.
    const sessionContext = { ...context, signal: controller.signal }
    mounting = mountApplication(definition, {
      ...target,
      context: sessionContext,
      onFailure: error => {
        if (!disposed && attempt === generation) target.onFailure(error)
      },
    }).then(next => {
      if (disposed || attempt !== generation) {
        void next.dispose()
        throw disposedWhileMounting(sessionContext)
      }
      application = next
      return next
    })
    // The first application rejects mountApp; a replacement fails the existing mount locally.
    void mounting.catch(error => {
      if (mounted && !disposed && attempt === generation) target.onFailure(error)
    })
  }

  const unsubscribe = context.runtime.shellState.observeTransitions(change => {
    if (
      !disposed &&
      change.transitions.some(
        transition => transition.kind === 'identity' || transition.kind === 'groups',
      )
    )
      start()
  })
  const dispose = (): Promise<void> => {
    if (disposed) return application?.dispose() ?? Promise.resolve()
    disposed = true
    generation += 1
    unsubscribe()
    context.signal.removeEventListener('abort', onAbort)
    controller?.abort()
    return application?.dispose() ?? Promise.resolve()
  }
  const onAbort = (): void => {
    void dispose()
  }
  context.signal.addEventListener('abort', onAbort, { once: true })

  const latestApplication = async (): Promise<Required<MountedApp>> => {
    while (!disposed) {
      const attempt = generation
      try {
        const next = await mounting
        if (attempt === generation) return next
      } catch (error) {
        if (attempt === generation) throw error
      }
    }
    throw disposedWhileMounting(context)
  }

  start()
  try {
    await latestApplication()
    mounted = true
  } catch (error) {
    await dispose()
    throw error
  }

  return {
    dispose,
    whenStable: async () => {
      while (!disposed) {
        const current = await latestApplication()
        await current.whenStable()
        if (current === application) return
      }
    },
  }
}

async function mountApplication(
  definition: AppDefinition,
  target: AppMountTarget,
): Promise<Required<MountedApp>> {
  const { context } = target
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
      return ref
    },
    start: (_ref, application) => {
      const { injector } = application
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
