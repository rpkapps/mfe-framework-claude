/**
 * The one non-route breadcrumb override, for flows a route tree cannot express.
 *
 * It replaces only the contributing App's own portion of the trail and clears
 * on unmount and on navigation, so a flow cannot leak its steps into the next
 * route. Items are compared by content, so authors need not memoize them.
 *
 * An empty array is *no override*, not an override with nothing in it. The
 * shape every caller reaches for is `useBreadcrumbs(inFlow ? steps : [])`, and
 * under the other reading that hook silently deleted the App's route-derived
 * crumbs for the whole time the flow was not running — the trail lost the
 * current page's own name and nobody could see why. An App that genuinely
 * contributes no crumbs at all says so once, with
 * `contributesBreadcrumbs: false` on its definition.
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
    const current = committed.current
    if (current.length > 0) breadcrumbs.setOverride(mountToken, current, ownerToken)

    return () => {
      breadcrumbs.clearOverride(mountToken, ownerToken)
    }
  }, [breadcrumbs, mountToken, ownerToken])

  useEffect(() => {
    committed.current = items
    if (items.length === 0) breadcrumbs.clearOverride(mountToken, ownerToken)
    else breadcrumbs.setOverride(mountToken, items, ownerToken)
  })
}
