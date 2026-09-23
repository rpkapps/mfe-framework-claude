/**
 * The steps every adapter takes when it derives an App's crumbs from its router, so a React App and
 * an Angular one label and mark a trail the same way.
 */

import type { BreadcrumbItem } from '@company/mfe-core'

/** `asset-reports` becomes `Asset reports`; a last resort when a route names no label. */
export function humanizeSegment(segment: string): string {
  const spaced = segment
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  if (spaced === '') return segment
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

/**
 * The deepest contributing item is the current page. Items and trail are frozen so the store can
 * compare by content and keep unchanged records by reference.
 */
export function withCurrentLast(items: readonly BreadcrumbItem[]): readonly BreadcrumbItem[] {
  const last = items.at(-1)
  if (last === undefined) return Object.freeze([])
  return Object.freeze([...items.slice(0, -1), Object.freeze({ ...last, current: true })])
}
