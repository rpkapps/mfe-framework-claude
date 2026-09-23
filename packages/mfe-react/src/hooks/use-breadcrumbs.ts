/**
 * Contributing breadcrumbs: inside a mount this overrides only that App's own portion of the
 * trail, outside one it publishes the host's crumbs at depth 0 (§26). An empty array is *no
 * override*, so `useBreadcrumbs(inFlow ? steps : [])` does not delete the App's route-derived
 * crumbs while the flow is idle. The store's `contribute` holds both rules.
 */

import { useEffect, useId, useRef } from 'react'
import type { BreadcrumbItem } from '@company/mfe-core'
import type { BreadcrumbContributionHandle } from '@company/mfe-runtime'

import { useOptionalMfeMount } from '../mount-context.tsx'
import { useMfeRuntime } from '../runtime-context.tsx'

export function useBreadcrumbs(items: readonly BreadcrumbItem[]): void {
  const mount = useOptionalMfeMount()
  const { breadcrumbs } = useMfeRuntime('useBreadcrumbs()')

  // So a competing override is diagnosed rather than winning by render order.
  const ownerToken = useId()
  const committed = useRef(items)
  const contribution = useRef<BreadcrumbContributionHandle | null>(null)

  const mountToken = mount?.mountToken ?? null

  // Where the component renders is fixed for its life, so this runs once per placement.
  useEffect(() => {
    const contributed = breadcrumbs.contribute(mountToken, ownerToken)
    contribution.current = contributed
    contributed.update(committed.current)

    return () => {
      contribution.current = null
      contributed.remove()
    }
  }, [breadcrumbs, mountToken, ownerToken])

  useEffect(() => {
    committed.current = items
    contribution.current?.update(items)
  })
}
