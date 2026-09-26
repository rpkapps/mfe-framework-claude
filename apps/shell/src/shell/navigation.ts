/**
 * The shell router's navigations, asked of the mounted Apps first (§20): the negotiation the
 * chrome's blocker runs for a link, and the agent's navigate tool runs before it moves the page.
 */

import {
  boundaryDefinitionId,
  createNavigationIntent,
  parseBoundaryLocation,
  type MfeRuntime,
  type NavigationOutcome,
} from '@company/mfe-react/host'

/** How the page is moving; the runtime's own type, which the host entry does not re-export. */
type NavigationAction = NonNullable<Parameters<typeof createNavigationIntent>[3]>

/** Asks every mounted App that could lose something whether the page may go from `from` to `to`. */
export function negotiateNavigation(
  runtime: MfeRuntime,
  from: string,
  to: string,
  action?: NavigationAction,
): Promise<NavigationOutcome> {
  return runtime.navigator.requestNavigation(
    createNavigationIntent(
      parseBoundaryLocation(from),
      parseBoundaryLocation(to),
      // Derived the same way the chrome derives it, so the two cannot disagree about which App
      // this negotiates with.
      `/${boundaryDefinitionId(from) ?? ''}`,
      action,
    ),
    // The router commits once this resolves, so there is nothing to commit here.
    () => {},
  )
}

/** The part of the shell's TanStack router a navigation reads. */
export interface NavigatingRouter {
  readonly state: { readonly location: { readonly pathname: string; readonly href: string } }
  navigate(options: { readonly href: string; readonly ignoreBlocker: true }): Promise<void>
}

/**
 * Goes to `href` as a link would, and resolves the URL the page is at afterwards, or `undefined`
 * when an App held the page. It asks first and then navigates past the blocker that would ask
 * again, because the router's own promise never settles for a navigation a blocker refused, and
 * the URL it lands on is the router's normalised one, not `href`.
 */
export function routerNavigation(
  router: NavigatingRouter,
  runtime: MfeRuntime,
): (href: string) => Promise<string | undefined> {
  return async href => {
    const outcome = await negotiateNavigation(runtime, router.state.location.pathname, href, 'PUSH')
    if (outcome === 'blocked') return undefined
    await router.navigate({ href, ignoreBlocker: true })
    return router.state.location.href
  }
}
