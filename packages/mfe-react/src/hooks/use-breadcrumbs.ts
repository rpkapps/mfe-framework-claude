/**
 * The one non-route breadcrumb override, for flows a route tree cannot express
 * — a wizard's steps, for example.
 *
 * It replaces only the contributing App's own portion of the trail. Shell
 * ancestors and nested child contributions are untouched. It clears when the
 * hook unmounts and on any navigation within the App, so a flow cannot leak its
 * steps into the next route.
 *
 * Items are immutable values compared by content, so an inline array of
 * unchanged records is a no-op and authors need not memoize it.
 */

import { useEffect, useId, useRef } from 'react'
import type { BreadcrumbItem } from '@company/mfe-core'

import { useMfeMount } from '../mount-context.tsx'

export function useBreadcrumbs(items: readonly BreadcrumbItem[]): void {
  const mount = useMfeMount('useBreadcrumbs')
  const { breadcrumbs } = mount.runtime
  const { mountToken } = mount

  // Identifies this hook instance as the override's owner, so a competing
  // override from a different component is diagnosed rather than silently
  // winning by render order.
  const ownerToken = useId()
  const committed = useRef(items)

  useEffect(() => {
    breadcrumbs.setOverride(mountToken, committed.current, ownerToken)

    return () => {
      breadcrumbs.clearOverride(mountToken, ownerToken)
    }
  }, [breadcrumbs, mountToken, ownerToken])

  useEffect(() => {
    committed.current = items
    breadcrumbs.setOverride(mountToken, items, ownerToken)
  })
}
