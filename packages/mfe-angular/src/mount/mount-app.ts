/**
 * Mounting an App: one Angular application per mount, with the App's routes over a location
 * strategy that reads and writes the host's navigation bridge rather than the browser's history.
 * The router starts its first navigation only once the root view is attached, because an
 * application that is not bootstrapped never runs the router's bootstrap listener.
 */

import { APP_BASE_HREF, LocationStrategy } from '@angular/common'
import { createComponent, DestroyRef, inject, type EnvironmentInjector } from '@angular/core'
import { createApplication } from '@angular/platform-browser'
import { provideRouter, Router, withDisabledInitialNavigation } from '@angular/router'
import { toMfeError } from '@company/mfe-core'
import type { AppMountTarget, MountContext, MountedApp } from '@company/mfe-host'

import type { AppDefinition } from '../definition.ts'
import { BoundaryLocationStrategy } from '../routing/boundary-location-strategy.ts'
import { contributeBreadcrumbs } from '../routing/breadcrumbs-from-routes.ts'
import {
  APP_NAVIGATION_BLOCKERS,
  provideMfeNavigationBlockers,
  registerAppNavigationBlocker,
} from '../routing/navigation-blockers.ts'
import {
  createHostElement,
  disposedWhileMounting,
  MountErrorHandler,
  provideMfeMount,
} from './mount-providers.ts'

/** What an Angular App's `mount` resolves to; the extras serve tests and Angular hosts. */
export interface AngularMountedApp extends MountedApp {
  /** The mount's own application injector, where the App's `Router` lives. */
  readonly injector: EnvironmentInjector
  /** Resolves once zoneless change detection and pending navigations have nothing left to do. */
  whenStable(): Promise<void>
}

/** `Location` strips this prefix from every path the strategy reads, as it would a real base href. */
function baseHrefOf(context: MountContext): string {
  return context.basePath === '' ? '/' : context.basePath
}

export async function mountApp(
  definition: AppDefinition,
  target: AppMountTarget,
): Promise<AngularMountedApp> {
  const { context } = target
  if (context.signal.aborted) throw disposedWhileMounting(context)

  const errors = new MountErrorHandler(context)
  const baseHref = baseHrefOf(context)

  const appRef = await createApplication({
    providers: [
      ...provideMfeMount(context, errors),
      provideRouter(definition.routes, withDisabledInitialNavigation()),
      { provide: APP_BASE_HREF, useValue: baseHref },
      {
        provide: LocationStrategy,
        useFactory: () => {
          const strategy = new BoundaryLocationStrategy(context.runtime.navigator, baseHref)
          inject(DestroyRef).onDestroy(() => {
            strategy.dispose()
          })
          return strategy
        },
      },
      provideMfeNavigationBlockers(),
      ...definition.providers,
    ],
  })

  if (context.signal.aborted) {
    appRef.destroy()
    throw disposedWhileMounting(context)
  }

  const { injector } = appRef
  const hostElement = createHostElement(target.element)
  const rendered = errors.capture(() => {
    const ref = createComponent(definition.component, {
      environmentInjector: injector,
      hostElement,
    })
    appRef.attachView(ref.hostView)
    appRef.tick()
  })

  if (!rendered.ok) {
    appRef.destroy()
    hostElement.remove()
    throw rendered.error
  }

  const router = injector.get(Router)
  const stopBlocking = registerAppNavigationBlocker({
    context,
    injector,
    blockers: injector.get(APP_NAVIGATION_BLOCKERS),
  })
  const stopBreadcrumbs = definition.contributesBreadcrumbs
    ? contributeBreadcrumbs(router, context, definition.id)
    : () => undefined

  router.initialNavigation()

  let disposal: Promise<void> | null = null
  const dispose = (): Promise<void> => {
    disposal ??= (async () => {
      // Registrations first, so a disposed App cannot be asked about a navigation mid-teardown.
      stopBlocking()
      stopBreadcrumbs()
      try {
        appRef.destroy()
      } catch (error) {
        context.runtime.diagnostics.report(
          toMfeError(error, {
            code: 'dispose/failure',
            id: definition.id,
            ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
            operation: 'dispose App',
            repair: 'Check the ngOnDestroy hooks and DestroyRef callbacks inside the App.',
          }),
        )
      }
      hostElement.remove()
      await Promise.resolve()
    })()
    return disposal
  }

  // The host disposes this handle before the context; a host that only disposes the context
  // still gets the application torn down.
  context.signal.addEventListener('abort', () => void dispose(), { once: true })

  return { injector, whenStable: () => appRef.whenStable(), dispose }
}
