/**
 * The migration seam each legacy Angular app adopts: one `provideAppInitializer`
 * argument is replaced by an initializer built here, and nothing else moves.
 * Angular is not a dependency and must not become one — the app owns its
 * Angular version — so the Angular surface below is described structurally.
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

export interface LegacyRouterSubscription {
  unsubscribe(): void
}

export interface LegacyRouterEventStream {
  subscribe(next: (event: LegacyRouterEvent) => void): LegacyRouterSubscription
}

/**
 * Only Angular's `NavigationStart` carries `navigationTrigger`, which is what
 * makes its presence a safe discriminator without importing the event classes.
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
 * Keeps the URL under the shell's control: on a navigation triggered by
 * anything other than the app itself, Angular must not write the location
 * again. Writing it twice is what makes the back button skip entries. This is
 * the replaced initializer's behaviour, kept verbatim.
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

export interface LegacyMigrationSeamOptions {
  /** The legacy registry name: container, single-spa activity and identity. */
  readonly name: string
  /** The base href from the app's single-spa props, when it receives one. */
  readonly baseHref?: string | undefined
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

/**
 * The base href is resolved through the shared resolver, so the seam an app
 * sees here is the one the shell uses when it mounts the parcel.
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
      const path = pathname.split(/[?#]/, 1)[0] ?? ''
      return path === withoutTrailingSlash || path.startsWith(prefix)
    },
    replaces: REPLACED_PROVIDER,
  }
}

export interface LegacyShellNavigationOptions extends LegacyMigrationSeamOptions {
  /**
   * Called from inside the initializer, which is where Angular's injection
   * context is available: the app passes `() => inject(Router)`.
   */
  readonly injectRouter: () => LegacyRouterPort
  /**
   * Optional teardown registration, for an app that wants the subscription tied
   * to its injector: `teardown => inject(DestroyRef).onDestroy(teardown)`.
   */
  readonly registerTeardown?: ((teardown: LegacyNavigationTeardown) => void) | undefined
}

/**
 * The initializer returns `undefined` on purpose: Angular waits on anything
 * promise-like an initializer returns, so the teardown goes to
 * `registerTeardown` instead. The seam is attached so the app can read the base
 * href, routes and expose path from the same object.
 */
export type LegacyShellNavigationInitializer = (() => void) & {
  readonly seam: LegacyMigrationSeam
}

export function createLegacyShellNavigationInitializer(
  options: LegacyShellNavigationOptions,
): LegacyShellNavigationInitializer {
  const initializer = (): void => {
    const teardown = skipLocationChangeOnNonImperativeTriggers(options.injectRouter())
    options.registerTeardown?.(teardown)
  }

  return Object.assign(initializer, { seam: createLegacyMigrationSeam(options) })
}
