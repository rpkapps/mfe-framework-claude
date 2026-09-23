/**
 * Contributing breadcrumbs: inside a mount this overrides only that App's own portion of the
 * trail, outside one it publishes the host's crumbs at depth 0. An empty array is *no override*,
 * so `injectBreadcrumbs(() => inFlow() ? steps() : [])` does not delete the App's route-derived
 * crumbs while the flow is idle.
 */

import {
  assertInInjectionContext,
  DestroyRef,
  effect,
  inject,
  untracked,
  type Signal,
} from '@angular/core'
import { HOST_SCOPE, type BreadcrumbItem } from '@company/mfe-core'

import { injectMfeRuntime, injectOptionalMfeMount } from './runtime.ts'

/** The host composes at 0; a top-level App is 1, one nested inside it 2. */
const HOST_DEPTH = 0

let nextOwner = 0

export function injectBreadcrumbs(
  items: Signal<readonly BreadcrumbItem[]> | (() => readonly BreadcrumbItem[]),
): void {
  assertInInjectionContext(injectBreadcrumbs)

  const mount = injectOptionalMfeMount()
  const { breadcrumbs } = injectMfeRuntime('injectBreadcrumbs()')
  const destroyRef = inject(DestroyRef)

  // So a competing override is diagnosed rather than winning by creation order.
  nextOwner += 1
  const ownerToken = `injectBreadcrumbs#${String(nextOwner)}`

  if (mount === null) {
    const contribution = breadcrumbs.registerMount(HOST_SCOPE, ownerToken, HOST_DEPTH)
    destroyRef.onDestroy(() => {
      contribution.remove()
    })
    effect(() => {
      const next = items()
      untracked(() => {
        contribution.update(next)
      })
    })
    return
  }

  const { mountToken } = mount
  destroyRef.onDestroy(() => {
    breadcrumbs.clearOverride(mountToken, ownerToken)
  })
  effect(() => {
    const next = items()
    untracked(() => {
      if (next.length === 0) breadcrumbs.clearOverride(mountToken, ownerToken)
      else breadcrumbs.setOverride(mountToken, next, ownerToken)
    })
  })
}
