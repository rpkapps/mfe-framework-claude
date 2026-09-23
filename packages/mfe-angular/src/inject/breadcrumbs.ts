/**
 * Contributing breadcrumbs: inside a mount this overrides only that App's own portion of the
 * trail, outside one it publishes the host's crumbs at depth 0. An empty array is *no override*,
 * so `injectBreadcrumbs(() => inFlow() ? steps() : [])` does not delete the App's route-derived
 * crumbs while the flow is idle. The store's `contribute` holds both rules.
 */

import {
  assertInInjectionContext,
  DestroyRef,
  effect,
  inject,
  untracked,
  type Signal,
} from '@angular/core'
import type { BreadcrumbItem } from '@company/mfe-core'

import { injectMfeRuntime, injectOptionalMfeMount } from './runtime.ts'

let nextOwner = 0

export function injectBreadcrumbs(
  items: Signal<readonly BreadcrumbItem[]> | (() => readonly BreadcrumbItem[]),
): void {
  assertInInjectionContext(injectBreadcrumbs)

  const mount = injectOptionalMfeMount()
  const { breadcrumbs } = injectMfeRuntime('injectBreadcrumbs()')

  // So a competing override is diagnosed rather than winning by creation order.
  nextOwner += 1
  const ownerToken = `injectBreadcrumbs#${String(nextOwner)}`

  const contribution = breadcrumbs.contribute(mount?.mountToken ?? null, ownerToken)
  inject(DestroyRef).onDestroy(() => {
    contribution.remove()
  })
  effect(() => {
    const next = items()
    untracked(() => {
      contribution.update(next)
    })
  })
}
