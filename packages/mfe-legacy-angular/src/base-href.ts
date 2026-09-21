/**
 * One resolver for the two base-href seams: one legacy app pins its own, the other takes
 * what single-spa hands its props. The seam table reflects contract fixtures (§9).
 */

import { createMfeError } from '@company/mfe-core'

import { LEGACY_NAVIGATION_OWNERSHIP, type NavigationOwnership } from './registry/legacy-config.ts'

/** How one legacy app obtains its base href. */
export type LegacyBaseHrefSeam =
  | { readonly kind: 'app-pinned'; readonly baseHref: string }
  | { readonly kind: 'delegated'; readonly fallback: string }

export type LegacyBaseHrefSource = 'app-pinned' | 'single-spa' | 'fallback'

export interface ResolvedLegacyBaseHref {
  /** Always starts and ends with a slash, or is an absolute URL ending in one. */
  readonly baseHref: string
  readonly source: LegacyBaseHrefSource
  /** Always 'shell': legacy apps are routed by the shell, never by themselves. */
  readonly navigationOwnership: NavigationOwnership
}

export interface ResolveLegacyBaseHrefOptions {
  /** The legacy registry name, which is also the container and activity name. */
  readonly name: string
  readonly suppliedBaseHref?: string | undefined
  /** Seam table override, so a shell that adds a legacy app need not edit this package. */
  readonly seams?: Readonly<Record<string, LegacyBaseHrefSeam>> | undefined
}

export const LEGACY_BASE_HREF_SEAMS: Readonly<Record<string, LegacyBaseHrefSeam>> = Object.freeze({
  'asset-tracker': Object.freeze({ kind: 'app-pinned', baseHref: '/asset-tracker/' }),
  rigstream: Object.freeze({ kind: 'delegated', fallback: '/rigstream/' }),
} as const)

/** An unlisted app delegates, so a third legacy app needs no new code here. */
export function defaultLegacyBaseHrefSeam(name: string): LegacyBaseHrefSeam {
  return { kind: 'delegated', fallback: `/${name}/` }
}

/** The trailing slash matters because Angular resolves routes relative to `APP_BASE_HREF`. */
export function normalizeBaseHref(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '/') return '/'

  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  const withLeadingSlash = absolute || trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

/** An app-pinned seam wins over what the shell supplies, because moving it breaks the app's deep links. */
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
