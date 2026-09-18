/**
 * Derives an App's breadcrumb contribution from its native router matches.
 *
 * Authors do not create route wrappers to contribute a breadcrumb: the adapter
 * reads the match tree the router already maintains. Label resolution is a
 * fixed order, not an inference over arbitrary loader data — guessing labels
 * from whatever fields a loader happens to return is exactly the kind of magic
 * that makes a trail change for reasons nobody can explain.
 */

import type { BreadcrumbItem } from '@company/mfe-core'

import type { MfeStaticData } from './router-contract.ts'

/** The slice of a router match this module needs. */
export interface BreadcrumbMatch {
  readonly id: string
  readonly pathname: string
  readonly staticData?: MfeStaticData | undefined
  /** The route's declared path segment, e.g. `/reports` or `$accountId`. */
  readonly routePath?: string | undefined
  /** Title metadata produced by the route's native `head` function. */
  readonly title?: string | undefined
  readonly params?: Readonly<Record<string, string>> | undefined
}

/** Parameters whose names carry no meaning worth showing to a user. */
const GENERIC_PARAM_NAMES = new Set(['id', '_splat', '*'])

/**
 * Turns `asset-reports` or `assetReports` into `Asset reports`. Only used as a
 * last resort, after explicit labels and title metadata.
 */
export function humanize(segment: string): string {
  const spaced = segment
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  if (spaced === '') return segment
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

function isPathlessOrIndex(match: BreadcrumbMatch): boolean {
  const path = match.routePath
  if (path === undefined || path === '') return true
  // A leading underscore marks a pathless layout route; `/` is an index route.
  return path === '/' || path.startsWith('_') || path.split('/').pop()?.startsWith('_') === true
}

function resolveLabel(match: BreadcrumbMatch): string | null {
  const explicit = match.staticData?.breadcrumb
  if (explicit === false) return null
  if (typeof explicit === 'string') return explicit

  if (match.title !== undefined && match.title !== '') return match.title

  const path = match.routePath
  if (path === undefined) return null

  const segment = path.split('/').filter(Boolean).pop()
  if (segment === undefined) return null

  if (segment.startsWith('$')) {
    const name = segment.slice(1)
    // A generic parameter renders nothing rather than showing a raw id.
    if (name === '' || GENERIC_PARAM_NAMES.has(name)) return null
    const value = match.params?.[name]
    return value === undefined ? humanize(name) : value
  }

  return humanize(segment)
}

/**
 * Composes one App's contribution, parent to child.
 *
 * The deepest contributing match is marked `current`. Items are frozen so the
 * store can compare them by content and keep unchanged records by reference.
 */
export function breadcrumbsFromMatches(
  matches: readonly BreadcrumbMatch[],
): readonly BreadcrumbItem[] {
  const items: BreadcrumbItem[] = []

  for (const match of matches) {
    if (isPathlessOrIndex(match)) continue

    const label = resolveLabel(match)
    if (label === null) continue

    items.push(
      Object.freeze({
        key: match.id,
        label,
        href: match.pathname,
      }),
    )
  }

  const last = items[items.length - 1]
  if (last) {
    items[items.length - 1] = Object.freeze({ ...last, current: true })
  }

  return Object.freeze(items)
}
