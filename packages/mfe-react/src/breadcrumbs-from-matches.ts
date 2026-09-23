/**
 * Derives an App's breadcrumb contribution from its router matches; label resolution is a fixed
 * order rather than an inference over whatever fields a loader happens to return.
 */

import type { BreadcrumbItem } from '@company/mfe-core'
import { humanizeSegment, withCurrentLast } from '@company/mfe-runtime'

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
    return value === undefined ? humanizeSegment(name) : value
  }

  return humanizeSegment(segment)
}

/** Items are frozen so the store can compare by content and keep unchanged records by reference. */
export function breadcrumbsFromMatches(
  matches: readonly BreadcrumbMatch[],
): readonly BreadcrumbItem[] {
  const items: BreadcrumbItem[] = []

  for (const match of matches) {
    if (isPathlessOrIndex(match)) continue

    const label = resolveLabel(match)
    if (label === null) continue

    items.push(Object.freeze({ key: match.id, label, href: match.pathname }))
  }

  return withCurrentLast(items)
}
