/**
 * The migration seam each legacy Angular app adopts in place of one `provideAppInitializer`
 * argument. Angular must not become a dependency, so its surface is described structurally.
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
} from '../registry/legacy-adapter.ts'

export interface LegacyRouterSubscription {
  unsubscribe(): void
}

export interface LegacyRouterEventStream {
  subscribe(next: (event: LegacyRouterEvent) => void): LegacyRouterSubscription
}

/** Only Angular's `NavigationStart` carries `navigationTrigger`, a discriminator needing no import. */
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

/** Keeps the URL under the shell's control: writing the location twice makes the back button skip entries. */
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
  readonly baseHref?: string | undefined
  readonly routes?: readonly string[] | undefined
  readonly settingsRoutes?: readonly string[] | undefined
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

/** Resolved through the shared resolver, so an app sees the seam the shell mounts with. */
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
  /** Called inside the initializer, where the injection context exists: `() => inject(Router)`. */
  readonly injectRouter: () => LegacyRouterPort
  /** Optional teardown registration: `teardown => inject(DestroyRef).onDestroy(teardown)`. */
  readonly registerTeardown?: ((teardown: LegacyNavigationTeardown) => void) | undefined
}

/** Returns `undefined` because Angular awaits anything promise-like, so teardown goes to `registerTeardown`. */
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
