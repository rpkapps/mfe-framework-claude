/**
 * The migration seam each legacy Angular app adopts.
 *
 * The edit an app makes is deliberately one line: the single existing
 * `provideAppInitializer(skipLocationChangeOnNonImperativeRoutingTriggers)` is
 * replaced by one initializer built here. Nothing else moves — the router
 * providers, the single-spa Angular bootstrap, the route tree, the feature
 * code, the app's own `APP_BASE_HREF` provider and the `./single-spa-app`
 * exposure all stay exactly as they are. A migration that asked for more than
 * one line would be rewritten app by app instead of adopted.
 *
 * Angular is not a dependency of this package and must not become one: the app
 * owns its Angular version, and a framework package that imported Angular would
 * pin it. So the seam is a plain factory that returns the initializer function
 * plus the metadata the app registers around it, and the Angular types it
 * touches are described structurally — Angular's own `Router` satisfies them.
 *
 * What the seam preserves is listed on the returned object so it can be
 * asserted in a test rather than promised in a comment: the delegated base
 * href, the single-spa activity and parcel expose path, the route metadata, and
 * shell-owned navigation.
 */

import {
  resolveLegacyBaseHref,
  type LegacyBaseHrefSeam,
  type ResolvedLegacyBaseHref,
} from '../base-href.ts'
import {
  LEGACY_NAVIGATION_OWNERSHIP,
  LEGACY_PARCEL_EXPOSE_NAME,
  type NavigationOwnership,
} from '../registry/legacy-config.ts'

/* -------------------------------------------------------------------------- */
/* The Angular surface, described structurally                                 */
/* -------------------------------------------------------------------------- */

export interface LegacyRouterSubscription {
  unsubscribe(): void
}

export interface LegacyRouterEventStream {
  subscribe(next: (event: LegacyRouterEvent) => void): LegacyRouterSubscription
}

/**
 * The fields this seam reads from a router event. Only Angular's
 * `NavigationStart` carries `navigationTrigger`, which is what makes its
 * presence a safe discriminator without importing the event classes.
 */
export interface LegacyRouterEvent {
  readonly navigationTrigger?: string
  readonly id?: number
  readonly url?: string
}

export interface LegacyNavigationExtras {
  skipLocationChange?: boolean
  replaceUrl?: boolean
}

export interface LegacyNavigation {
  readonly extras: LegacyNavigationExtras
}

/** What the initializer needs from Angular's `Router`. */
export interface LegacyRouterPort {
  readonly events: LegacyRouterEventStream
  getCurrentNavigation(): LegacyNavigation | null | undefined
}

export type LegacyNavigationTeardown = () => void

/** Angular's own name for a navigation the app itself started. */
export const IMPERATIVE_NAVIGATION_TRIGGER = 'imperative'

/**
 * Keeps the URL under the shell's control.
 *
 * A legacy app is routed by the shell, so when a navigation is triggered by
 * anything other than the app itself — browser back and forward, or the shell
 * driving single-spa — Angular must not write the location again. Writing it
 * twice is what makes the back button skip entries.
 *
 * This is the behaviour the replaced initializer had, kept verbatim so the
 * migration changes wiring and not routing.
 */
export function skipLocationChangeOnNonImperativeTriggers(
  router: LegacyRouterPort,
): LegacyNavigationTeardown {
  const subscription = router.events.subscribe(event => {
    const trigger = event.navigationTrigger
    if (trigger === undefined || trigger === IMPERATIVE_NAVIGATION_TRIGGER) return

    const navigation = router.getCurrentNavigation()
    if (!navigation) return
    navigation.extras.skipLocationChange = true
  })

  return () => subscription.unsubscribe()
}

/* -------------------------------------------------------------------------- */
/* The seam                                                                    */
/* -------------------------------------------------------------------------- */

export interface LegacyMigrationSeamOptions {
  /** The legacy registry name: container, single-spa activity and identity. */
  readonly name: string
  /** The base href from the app's single-spa props, when it receives one. */
  readonly baseHref?: string | undefined
  /** Route metadata from the registry entry, carried through unchanged. */
  readonly routes?: readonly string[] | undefined
  readonly settingsRoutes?: readonly string[] | undefined
  /** Base-href seam table override; defaults to the documented seams. */
  readonly seams?: Readonly<Record<string, LegacyBaseHrefSeam>> | undefined
}

/** Everything the one-line edit preserves, in a form a test can assert. */
export interface LegacyMigrationSeam {
  readonly name: string
  readonly baseHref: ResolvedLegacyBaseHref
  /** The value the app keeps providing as `APP_BASE_HREF`. */
  readonly appBaseHref: string
  readonly navigationOwnership: NavigationOwnership
  readonly routes: readonly string[]
  readonly settingsRoutes: readonly string[]
  /** The federation expose path the shell loads the parcel from. */
  readonly parcelExposeName: typeof LEGACY_PARCEL_EXPOSE_NAME
  /** The single-spa activity predicate, derived from the resolved base href. */
  readonly activeWhen: (pathname: string) => boolean
  /** The provider this seam replaces, one for one. */
  readonly replaces: string
}

const REPLACED_PROVIDER = 'provideAppInitializer(skipLocationChangeOnNonImperativeRoutingTriggers)'

/** Reduces a base href to a path prefix, so an absolute one still works. */
function baseHrefPathname(baseHref: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(baseHref)) return baseHref
  try {
    return new URL(baseHref).pathname
  } catch {
    return baseHref
  }
}

function pathOf(pathname: string): string {
  return pathname.split(/[?#]/, 1)[0] ?? ''
}

/**
 * Builds the seam for one legacy app.
 *
 * The base href is resolved through the shared resolver, so an app that pins
 * its own keeps it and an app that delegates gets the shell's value or its
 * fallback — the same two seams the shell uses when it mounts the parcel.
 */
export function createLegacyMigrationSeam(
  options: LegacyMigrationSeamOptions,
): LegacyMigrationSeam {
  const baseHref = resolveLegacyBaseHref({
    name: options.name,
    suppliedBaseHref: options.baseHref,
    seams: options.seams,
  })

  const prefix = baseHrefPathname(baseHref.baseHref)
  const withoutTrailingSlash = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix

  return {
    name: options.name,
    baseHref,
    appBaseHref: baseHref.baseHref,
    navigationOwnership: LEGACY_NAVIGATION_OWNERSHIP,
    routes: options.routes ?? [],
    settingsRoutes: options.settingsRoutes ?? [],
    parcelExposeName: LEGACY_PARCEL_EXPOSE_NAME,
    activeWhen: pathname => {
      const path = pathOf(pathname)
      return path === withoutTrailingSlash || path.startsWith(prefix)
    },
    replaces: REPLACED_PROVIDER,
  }
}

/* -------------------------------------------------------------------------- */
/* The provider the app registers                                              */
/* -------------------------------------------------------------------------- */

export interface LegacyShellNavigationOptions extends LegacyMigrationSeamOptions {
  /**
   * Called from inside the initializer, which is where Angular's injection
   * context is available: the app passes `() => inject(Router)`.
   */
  readonly injectRouter: () => LegacyRouterPort
  /**
   * Optional teardown registration, for an app that wants the subscription tied
   * to its injector: `teardown => inject(DestroyRef).onDestroy(teardown)`.
   * Without it the subscription lives as long as the app's injector, which the
   * parcel's unmount destroys.
   */
  readonly registerTeardown?: ((teardown: LegacyNavigationTeardown) => void) | undefined
}

/**
 * The initializer function the app registers, with the seam attached so the app
 * can read the base href, routes and expose path from the same object.
 *
 * It returns `undefined` on purpose. Angular inspects an initializer's return
 * value and would wait on anything promise-like, so the teardown is handed to
 * `registerTeardown` instead of being returned.
 */
export type LegacyShellNavigationInitializer = (() => void) & {
  readonly seam: LegacyMigrationSeam
}

export function createLegacyShellNavigationInitializer(
  options: LegacyShellNavigationOptions,
): LegacyShellNavigationInitializer {
  const seam = createLegacyMigrationSeam(options)

  const initializer = (): void => {
    const teardown = skipLocationChangeOnNonImperativeTriggers(options.injectRouter())
    options.registerTeardown?.(teardown)
  }

  return Object.assign(initializer, { seam })
}
