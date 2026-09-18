/**
 * Delegated base href, and the shell-owned navigation the legacy apps assume.
 *
 * Two seams exist in the legacy applications and both are preserved rather than
 * rewritten:
 *
 * - one app pins its own base href and keeps providing it to Angular as
 *   `APP_BASE_HREF`. Whatever the shell supplies is not allowed to move it.
 * - the other consumes the base href single-spa hands its lifecycle props and
 *   falls back to its own prefix when the shell supplies none.
 *
 * Both reduce to the same question — "what is this app's base href for this
 * mount?" — so there is one resolver with two seam kinds instead of two code
 * paths. New Apps own their navigation; a legacy app does not, which is why the
 * result also states who owns the URL.
 *
 * The seam table below reflects production-equivalent fixtures, not a reading
 * of the legacy repositories, which are not available here.
 */

import { createMfeError } from '@company/mfe-core'

import { LEGACY_NAVIGATION_OWNERSHIP, type NavigationOwnership } from './registry/legacy-config.ts'

/** How one legacy app obtains its base href. */
export type LegacyBaseHrefSeam =
  /** The app provides its own `APP_BASE_HREF` and ignores what the shell offers. */
  | { readonly kind: 'app-pinned'; readonly baseHref: string }
  /** The app consumes the base href from its single-spa props, with a fallback. */
  | { readonly kind: 'delegated'; readonly fallback: string }

/** Where the resolved value came from. Carried into diagnostics and tests. */
export type LegacyBaseHrefSource = 'app-pinned' | 'single-spa' | 'fallback'

export interface ResolvedLegacyBaseHref {
  /** Always starts and ends with a slash, or is an absolute URL ending in one. */
  readonly baseHref: string
  readonly source: LegacyBaseHrefSource
  /** Legacy apps are routed by the shell. This never becomes 'app'. */
  readonly navigationOwnership: NavigationOwnership
}

export interface ResolveLegacyBaseHrefOptions {
  /** The legacy registry name, which is also the container and activity name. */
  readonly name: string
  /** The base href single-spa supplies in the parcel props, when it does. */
  readonly suppliedBaseHref?: string | undefined
  /**
   * Seam table override. Defaults to the documented seams; a shell that adds a
   * legacy app passes its own entry here rather than editing this package.
   */
  readonly seams?: Readonly<Record<string, LegacyBaseHrefSeam>> | undefined
}

/**
 * The two documented seams.
 *
 * `asset-tracker` keeps providing `APP_BASE_HREF` itself. `rigstream` reads the
 * single-spa base href and falls back to its own prefix.
 */
export const LEGACY_BASE_HREF_SEAMS: Readonly<Record<string, LegacyBaseHrefSeam>> = Object.freeze({
  'asset-tracker': Object.freeze({ kind: 'app-pinned', baseHref: '/asset-tracker/' }),
  rigstream: Object.freeze({ kind: 'delegated', fallback: '/rigstream/' }),
} as const)

/**
 * The seam an unlisted legacy app gets: the shell supplies the base href, and
 * the app's own name is the fallback prefix. That is what the documented
 * delegating app does, so a third legacy app needs no new code to behave the
 * same way.
 */
export function defaultLegacyBaseHrefSeam(name: string): LegacyBaseHrefSeam {
  return { kind: 'delegated', fallback: `/${name}/` }
}

/**
 * Normalizes a base href to the form Angular's `APP_BASE_HREF` expects: a
 * leading slash and a trailing slash, or an absolute URL with a trailing slash.
 * A trailing slash matters because Angular resolves routes relative to it.
 */
export function normalizeBaseHref(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '/') return '/'

  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  const withLeadingSlash = absolute || trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

/**
 * Resolves the base href for one legacy mount.
 *
 * An app-pinned seam wins over whatever the shell supplies, because moving it
 * would break the app's own `APP_BASE_HREF` provider and its deep links. A
 * delegated seam takes the supplied value, and falls back when the shell
 * supplies nothing — an empty string counts as nothing, which is the case the
 * fallback exists for.
 */
export function resolveLegacyBaseHref(
  options: ResolveLegacyBaseHrefOptions,
): ResolvedLegacyBaseHref {
  const name = options.name.trim()
  if (name === '') {
    throw createMfeError({
      code: 'app/invalid-base-path',
      id: '<unknown>',
      operation: 'resolve the legacy base href',
      expected: 'a legacy app name',
      observed: 'an empty name',
      declaredBy: 'The legacy adapter',
      repair:
        'Pass the name from the registry entry. It is the same value used as the container name and the single-spa activity name.',
    })
  }

  const seams = options.seams ?? LEGACY_BASE_HREF_SEAMS
  const seam = seams[name] ?? defaultLegacyBaseHrefSeam(name)

  if (seam.kind === 'app-pinned') {
    return {
      baseHref: normalizeBaseHref(seam.baseHref),
      source: 'app-pinned',
      navigationOwnership: LEGACY_NAVIGATION_OWNERSHIP,
    }
  }

  const supplied = options.suppliedBaseHref
  if (typeof supplied === 'string' && supplied.trim() !== '') {
    return {
      baseHref: normalizeBaseHref(supplied),
      source: 'single-spa',
      navigationOwnership: LEGACY_NAVIGATION_OWNERSHIP,
    }
  }

  return {
    baseHref: normalizeBaseHref(seam.fallback),
    source: 'fallback',
    navigationOwnership: LEGACY_NAVIGATION_OWNERSHIP,
  }
}
