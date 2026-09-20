/**
 * Contributing breadcrumbs: the one non-route override inside a mount, and the
 * host's own trail outside one.
 *
 * Inside a mount it replaces only the contributing App's own portion of the
 * trail and clears on unmount and on navigation, so a flow cannot leak its
 * steps into the next route. Items are compared by content, so authors need not
 * memoize them.
 *
 * An empty array is *no override*, not an override with nothing in it: the
 * shape every caller reaches for is `useBreadcrumbs(inFlow ? steps : [])`, and
 * under the other reading that deletes the App's route-derived crumbs for the
 * whole time the flow is not running. An App that contributes none at all says
 * so once, with `contributesBreadcrumbs: false` on its definition.
 *
 * Outside a mount the same call publishes the host's own crumbs, at the depth
 * every mount composes below — the framework knows what that depth is and what
 * to call it, so a host does not have to invent a mount token to be keyed by.
 */

import { useEffect, useId, useRef } from 'react'
import { HOST_SCOPE, type BreadcrumbItem } from '@company/mfe-core'
import type { BreadcrumbContributionHandle } from '@company/mfe-host'

import { useOptionalMfeMount } from '../mount-context.tsx'
import { useMfeRuntime } from '../runtime-context.tsx'

/** The host composes at 0; a top-level App is 1, one nested inside it 2. */
const HOST_DEPTH = 0

export function useBreadcrumbs(items: readonly BreadcrumbItem[]): void {
  const mount = useOptionalMfeMount()
  const { breadcrumbs } = useMfeRuntime('useBreadcrumbs()')

  // Identifies this hook instance: the override's owner inside a mount, so a
  // competing one is diagnosed rather than winning by render order, and the
  // contribution's own key outside one.
  const ownerToken = useId()
  const committed = useRef(items)
  const contribution = useRef<BreadcrumbContributionHandle | null>(null)

  const mountToken = mount?.mountToken

  // Two registrations, one of which is inert in any given component: which of
  // the two applies is fixed for a component's life by where it renders.
  useEffect(() => {
    if (mountToken !== undefined) return undefined

    const registered = breadcrumbs.registerMount(HOST_SCOPE, ownerToken, HOST_DEPTH)
    contribution.current = registered
    registered.update(committed.current)

    return () => {
      contribution.current = null
      registered.remove()
    }
  }, [breadcrumbs, mountToken, ownerToken])

  useEffect(() => {
    if (mountToken === undefined) return undefined

    const current = committed.current
    if (current.length > 0) breadcrumbs.setOverride(mountToken, current, ownerToken)

    return () => {
      breadcrumbs.clearOverride(mountToken, ownerToken)
    }
  }, [breadcrumbs, mountToken, ownerToken])

  useEffect(() => {
    committed.current = items

    if (mountToken === undefined) {
      contribution.current?.update(items)
      return
    }

    if (items.length === 0) breadcrumbs.clearOverride(mountToken, ownerToken)
    else breadcrumbs.setOverride(mountToken, items, ownerToken)
  })
}
