/** Reload route decisions under the new identity without changing the URL or reusing old data. */

import type { ActivatedRouteSnapshot, Route, Router } from '@angular/router'
import { createMfeError, withoutUndefined } from '@company/mfe-core'
import type { MountContext } from '@company/mfe-runtime'

export function refreshRoutesOnSessionChange(
  router: Router,
  context: MountContext,
  element: HTMLElement,
  onFailure: (error: unknown) => void,
  renderCurrentSession: () => void,
): () => void {
  let generation = 0
  let stopped = false
  const originalPolicies = new Map<Route, Route['runGuardsAndResolvers']>()
  const originallyHidden = element.hidden
  const originalDisplay = element.style.getPropertyValue('display')
  const originalDisplayPriority = element.style.getPropertyPriority('display')

  // Active snapshots include lazy routes. Their routeConfig objects belong to this router, so
  // changing a policy preserves Angular's route reuse and never mutates the author's definition.
  const forceRefresh = (snapshot: ActivatedRouteSnapshot): void => {
    const config = snapshot.routeConfig
    if (config !== null) {
      if (!originalPolicies.has(config)) originalPolicies.set(config, config.runGuardsAndResolvers)
      config.runGuardsAndResolvers = 'always'
    }
    for (const child of snapshot.children) forceRefresh(child)
  }
  const restorePolicies = (): void => {
    for (const [config, policy] of originalPolicies) {
      if (policy === undefined) delete config.runGuardsAndResolvers
      else config.runGuardsAndResolvers = policy
    }
    originalPolicies.clear()
  }

  const unsubscribe = context.runtime.shellState.observeTransitions(change => {
    if (stopped || context.signal.aborted) return
    if (
      !change.transitions.some(
        transition => transition.kind === 'identity' || transition.kind === 'groups',
      )
    )
      return

    const navigation = router.getCurrentNavigation()
    // An App that has never entered its boundary has no route data to retire.
    if (!router.navigated && navigation === null) return

    const attempt = ++generation
    forceRefresh(router.routerState.snapshot.root)
    element.hidden = true
    // The mount element has inline display:contents, which overrides the browser's [hidden]
    // rule. An inline important value also wins over an author's scoped display rule.
    element.style.setProperty('display', 'none', 'important')
    element.setAttribute('aria-busy', 'true')
    const target = navigation?.finalUrl ?? navigation?.extractedUrl ?? router.url
    void router
      .navigateByUrl(target, {
        onSameUrlNavigation: 'reload',
        skipLocationChange: true,
      })
      .then(
        accepted => {
          if (stopped || attempt !== generation) return
          restorePolicies()
          element.removeAttribute('aria-busy')
          if (accepted) {
            try {
              // Zoneless signal updates schedule a tick; commit the new resolver data before the
              // element becomes visible so the previous session never flashes during that gap.
              renderCurrentSession()
            } catch (error) {
              onFailure(error)
              return
            }
            if (originalDisplay === '') element.style.removeProperty('display')
            else element.style.setProperty('display', originalDisplay, originalDisplayPriority)
            element.hidden = originallyHidden
            return
          }
          // A denied guard or failed resolver must not expose the previous identity's route data.
          onFailure(
            createMfeError({
              code: 'mount/failure',
              id: context.definitionId,
              ...withoutUndefined({ definitionVersion: context.definitionVersion }),
              operation: 'refresh routes after a session change',
              expected: 'guards and resolvers to accept navigation under the current session',
              observed: 'the session refresh navigation was rejected or failed',
              repair: 'Check the current user and permissions, then retry the App.',
            }),
          )
        },
        error => {
          if (!stopped && attempt === generation) onFailure(error)
        },
      )
  })

  return () => {
    stopped = true
    unsubscribe()
    restorePolicies()
    element.removeAttribute('aria-busy')
  }
}
