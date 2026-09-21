/**
 * Contributing breadcrumbs: inside a mount this overrides only that App's own portion of the
 * trail, outside one it publishes the host's crumbs at depth 0 (§26). An empty array is *no
 * override*, so `useBreadcrumbs(inFlow ? steps : [])` does not delete the App's route-derived
 * crumbs while the flow is idle.
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

  // So a competing override is diagnosed rather than winning by render order.
  const ownerToken = useId()
  const committed = useRef(items)
  const contribution = useRef<BreadcrumbContributionHandle | null>(null)

  const mountToken = mount?.mountToken

  // Which of the two registrations applies is fixed for a component's life by where it renders.
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
