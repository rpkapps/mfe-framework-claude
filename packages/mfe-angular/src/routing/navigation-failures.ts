/**
 * An App's failed navigations — a lazy chunk that did not load, a guard or a resolver that threw —
 * reach the mount. The router hands them to the navigation's promise and a `NavigationError`
 * event, never to the `ErrorHandler`, so without this the App sat mounted over an empty outlet.
 */

import type { EnvironmentProviders, Provider } from '@angular/core'
import {
  NavigationEnd,
  NavigationError,
  ROUTER_CONFIGURATION,
  withRouterConfig,
  type Router,
  type RouterConfigOptions,
  type RouterFeatures,
} from '@angular/router'
import { toMfeError, withoutUndefined, type MfeError } from '@company/mfe-core'
import type { MountContext } from '@company/mfe-runtime'

/**
 * The options the App passed to `withRouterConfig`, which the mount's own configuration replaces
 * and so has to carry over. The router provides them as a plain value.
 */
function configuredOptions(features: readonly RouterFeatures[]): RouterConfigOptions {
  const kind = withRouterConfig({}).ɵkind
  let options: RouterConfigOptions = {}
  for (const feature of features) {
    if (feature.ɵkind !== kind) continue
    for (const provider of feature.ɵproviders) {
      if (isRouterConfiguration(provider)) options = provider.useValue
    }
  }
  return options
}

function isRouterConfiguration(
  provider: Provider | EnvironmentProviders,
): provider is { provide: typeof ROUTER_CONFIGURATION; useValue: RouterConfigOptions } {
  return (
    typeof provider === 'object' &&
    'provide' in provider &&
    provider.provide === ROUTER_CONFIGURATION &&
    'useValue' in provider
  )
}

/**
 * A failed navigation resolves `false` rather than rejecting. The router starts the first
 * navigation, and every one the location reports, without keeping its promise, so a rejection
 * there would be unhandled; the failure still arrives as the event `reportNavigationFailures`
 * reads. Placed after the App's features, so the App's other options are kept by copying them.
 */
export function provideSettledNavigations(features: readonly RouterFeatures[]): Provider {
  return {
    provide: ROUTER_CONFIGURATION,
    useValue: { ...configuredOptions(features), resolveNavigationPromiseOnError: true },
  }
}

/** The route without its query or fragment, which can carry a token. */
function routeOf(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? url
}

function navigationFailure(
  context: MountContext,
  event: NavigationError,
  routed: boolean,
): MfeError {
  const { definitionId, definitionVersion } = context
  const route = routeOf(event.url)
  const check = 'Check that route’s loadComponent, loadChildren, guards and resolvers'
  return toMfeError(event.error, {
    code: 'mount/failure',
    id: definitionId,
    ...withoutUndefined({ definitionVersion }),
    operation: routed ? `navigate to ${route}` : `render its first route, ${route}`,
    repair: routed
      ? `${check}; the App stays on the route it was showing.`
      : `${check}, then retry; the cause attached to this error is what failed.`,
  })
}

/**
 * Until the App has completed a navigation its outlet is empty, so a failure then is the mount's
 * fatal failure and the host offers a retry. After that the App keeps the route it has, and the
 * failure is reported. Returns what stops listening.
 */
export function reportNavigationFailures(
  router: Router,
  context: MountContext,
  onFailure: (error: unknown) => void,
): () => void {
  let routed = false
  const subscription = router.events.subscribe(event => {
    if (event instanceof NavigationEnd) {
      routed = true
      return
    }
    if (!(event instanceof NavigationError)) return

    const failure = navigationFailure(context, event, routed)
    if (!routed) {
      onFailure(failure)
      return
    }
    context.runtime.diagnostics.report(failure, { context: { mount: context.definitionId } })
  })
  return () => {
    subscription.unsubscribe()
  }
}
