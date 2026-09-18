/**
 * Two base-href seams exist in the legacy applications and both are preserved:
 * one app pins its own, the other consumes what single-spa hands its props.
 * Both answer the same question, so there is one resolver with two seam kinds.
 * The seam table reflects contract fixtures, not the legacy repositories.
 */

import { createMfeError } from '@company/mfe-core'

import { LEGACY_NAVIGATION_OWNERSHIP, type NavigationOwnership } from './registry/legacy-config.ts'

/** How one legacy app obtains its base href. */
export type LegacyBaseHrefSeam =
  | { readonly kind: 'app-pinned'; readonly baseHref: string }
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
   * Seam table override, so a shell that adds a legacy app does not have to
   * edit this package.
   */
  readonly seams?: Readonly<Record<string, LegacyBaseHrefSeam>> | undefined
}

/** The two documented seams. */
export const LEGACY_BASE_HREF_SEAMS: Readonly<Record<string, LegacyBaseHrefSeam>> = Object.freeze({
  'asset-tracker': Object.freeze({ kind: 'app-pinned', baseHref: '/asset-tracker/' }),
  rigstream: Object.freeze({ kind: 'delegated', fallback: '/rigstream/' }),
} as const)

/**
 * The seam an unlisted legacy app gets, which is what the documented delegating
 * app does — so a third legacy app needs no new code to behave the same way.
 */
export function defaultLegacyBaseHrefSeam(name: string): LegacyBaseHrefSeam {
  return { kind: 'delegated', fallback: `/${name}/` }
}

/**
 * Normalizes to the form Angular's `APP_BASE_HREF` expects. The trailing slash
 * matters because Angular resolves routes relative to it.
 */
export function normalizeBaseHref(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '/') return '/'

  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  const withLeadingSlash = absolute || trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

/**
 * An app-pinned seam wins over whatever the shell supplies, because moving it
 * would break the app's own `APP_BASE_HREF` provider and its deep links. A
 * delegated seam takes the supplied value, and falls back when the shell
 * supplies nothing — an empty string counts as nothing.
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
      repair: 'Pass the name from the registry entry.',
    })
  }

  const seam = (options.seams ?? LEGACY_BASE_HREF_SEAMS)[name] ?? defaultLegacyBaseHrefSeam(name)
  const navigationOwnership = LEGACY_NAVIGATION_OWNERSHIP

  if (seam.kind === 'app-pinned') {
    return { baseHref: normalizeBaseHref(seam.baseHref), source: 'app-pinned', navigationOwnership }
  }

  const supplied = options.suppliedBaseHref
  if (typeof supplied === 'string' && supplied.trim() !== '') {
    return { baseHref: normalizeBaseHref(supplied), source: 'single-spa', navigationOwnership }
  }

  return { baseHref: normalizeBaseHref(seam.fallback), source: 'fallback', navigationOwnership }
}
