/**
 * Angular's `canDeactivate` guards and `injectNavigationBlock`, extended to the navigations an App
 * does not own: the mount registers one delegate with the host's navigator and answers it out of
 * the App's own guards and blockers.
 */

import {
  InjectionToken,
  runInInjectionContext,
  type EnvironmentInjector,
  type Provider,
  type ProviderToken,
} from '@angular/core'
import {
  ChildrenOutletContexts,
  RedirectCommand,
  Router,
  UrlTree,
  type ActivatedRouteSnapshot,
  type CanDeactivateFn,
  type OutletContext,
  type RouterStateSnapshot,
} from '@angular/router'
import type { BoundaryLocation, NavigationIntent, Unsubscribe } from '@company/mfe-core'
import type { MountContext, NavigationBlocker } from '@company/mfe-host'
import { firstValueFrom, isObservable } from 'rxjs'

/** What `injectNavigationBlock` registers; the host's own blocker minus the depth it lacks. */
export type MountNavigationBlocker = Omit<NavigationBlocker, 'depth'>

/** The `injectNavigationBlock` registrations inside one App, in registration order. */
export class AppNavigationBlockers {
  readonly #blockers = new Set<MountNavigationBlocker>()

  add(blocker: MountNavigationBlocker): Unsubscribe {
    this.#blockers.add(blocker)
    return () => {
      this.#blockers.delete(blocker)
    }
  }

  list(): readonly MountNavigationBlocker[] {
    return [...this.#blockers]
  }
}

/** Provided only inside an App mount, so a Widget's blocker registers with the navigator itself. */
export const APP_NAVIGATION_BLOCKERS = new InjectionToken<AppNavigationBlockers>(
  'APP_NAVIGATION_BLOCKERS',
)

export function provideMfeNavigationBlockers(): Provider {
  return { provide: APP_NAVIGATION_BLOCKERS, useFactory: () => new AppNavigationBlockers() }
}

/**
 * A mount torn down mid-negotiation never answers, so the host would wait forever and refuse
 * every later navigation as "already negotiating".
 */
function whenDisposed(mount: AbortSignal, until: AbortSignal): Promise<'proceed'> {
  return new Promise(resolve => {
    if (mount.aborted) {
      resolve('proceed')
      return
    }
    mount.addEventListener(
      'abort',
      () => {
        resolve('proceed')
      },
      { once: true, signal: until },
    )
  })
}

interface Deactivation {
  readonly route: ActivatedRouteSnapshot
  readonly guards: readonly unknown[]
  readonly component: unknown
  readonly injector: EnvironmentInjector
}

/**
 * Every active route with guards, deepest first and each outlet's component beside it: the order
 * and the component the router itself would use to deactivate the whole tree.
 */
function collectDeactivations(
  route: ActivatedRouteSnapshot,
  context: OutletContext | null,
  fallback: EnvironmentInjector,
  found: Deactivation[],
): void {
  for (const child of route.children) {
    // A componentless route renders nothing, so its children live in its own outlet context.
    const childContext =
      route.component === null ? context : (context?.children.getContext(child.outlet) ?? null)
    collectDeactivations(child, childContext, fallback, found)
  }

  const guards = route.routeConfig?.canDeactivate ?? []
  if (guards.length === 0) return

  const outlet = context?.outlet
  found.push({
    route,
    guards,
    component: route.component !== null && outlet?.isActivated === true ? outlet.component : null,
    injector: context?.injector ?? fallback,
  })
}

function deactivationsOf(
  state: RouterStateSnapshot,
  contexts: ChildrenOutletContexts,
  injector: EnvironmentInjector,
): readonly Deactivation[] {
  const found: Deactivation[] = []
  for (const child of state.root.children) {
    collectDeactivations(child, contexts.getContext(child.outlet), injector, found)
  }
  return found
}

/** Cheap and synchronous, as the host requires: guards exist, not what they would answer. */
function hasDeactivationGuards(state: RouterStateSnapshot): boolean {
  const pending = [state.root]
  for (let route = pending.pop(); route !== undefined; route = pending.pop()) {
    if ((route.routeConfig?.canDeactivate ?? []).length > 0) return true
    pending.push(...route.children)
  }
  return false
}

const NOT_PROVIDED = Symbol('not provided')

/** The same resolution the router applies: a provided token or class, else a guard function. */
function runGuard(
  guard: unknown,
  deactivation: Deactivation,
  currentState: RouterStateSnapshot,
  nextState: RouterStateSnapshot,
): unknown {
  const { injector, component, route } = deactivation
  const provided = injector.get(guard as ProviderToken<unknown>, NOT_PROVIDED)

  if (provided !== NOT_PROVIDED) {
    const instance = provided as {
      canDeactivate?: (...args: readonly unknown[]) => unknown
    }
    if (typeof instance.canDeactivate === 'function') {
      return instance.canDeactivate(component, route, currentState, nextState)
    }
  }

  const fn = guard as CanDeactivateFn<unknown>
  return runInInjectionContext(injector, () => fn(component, route, currentState, nextState))
}

async function settle(result: unknown): Promise<unknown> {
  if (isObservable(result)) return await firstValueFrom(result)
  return await result
}

function hrefOf(location: BoundaryLocation): string {
  return `${location.pathname}${location.search}${location.hash}`
}

/**
 * Runs the guards of the whole active tree, as leaving the App deactivates all of it. A redirect
 * keeps the host where it is and sends the App to the redirect instead, as the router would.
 */
async function runDeactivationGuards(
  router: Router,
  contexts: ChildrenOutletContexts,
  injector: EnvironmentInjector,
  intent: NavigationIntent,
): Promise<'proceed' | 'reset'> {
  const currentState = router.routerState.snapshot
  // A host navigation has no target inside the App, so `nextState` is the current tree carrying
  // the target URL: the part a guard deciding "where is the user going" reads.
  const nextState = Object.create(currentState, {
    url: { value: hrefOf(intent.to), enumerable: true },
  }) as RouterStateSnapshot

  for (const deactivation of deactivationsOf(currentState, contexts, injector)) {
    for (const guard of deactivation.guards) {
      const result = await settle(runGuard(guard, deactivation, currentState, nextState))
      if (result === true) continue

      if (result instanceof UrlTree) {
        void router.navigateByUrl(result)
      } else if (result instanceof RedirectCommand) {
        void router.navigateByUrl(result.redirectTo, result.navigationBehaviorOptions)
      }
      return 'reset'
    }
  }

  return 'proceed'
}

export interface AppNavigationBlockerOptions {
  readonly context: MountContext
  readonly injector: EnvironmentInjector
  readonly blockers: AppNavigationBlockers
}

/**
 * Guards are asked only about navigations that leave the App: inside its boundary the location
 * reaches the App's router, which runs them itself, and asking here as well would ask twice.
 */
export function registerAppNavigationBlocker({
  context,
  injector,
  blockers,
}: AppNavigationBlockerOptions): Unsubscribe {
  const router = injector.get(Router)
  const contexts = injector.get(ChildrenOutletContexts)

  const askEveryone = async (intent: NavigationIntent): Promise<'proceed' | 'reset'> => {
    if (intent.leavesBoundary) {
      const guarded = await runDeactivationGuards(router, contexts, injector, intent)
      if (guarded === 'reset') return 'reset'
    }

    for (const blocker of blockers.list()) {
      if (!blocker.shouldBlock(intent)) continue
      if ((await blocker.confirm(intent)) === 'reset') return 'reset'
    }
    return 'proceed'
  }

  const delegate: NavigationBlocker = {
    depth: context.depth,

    shouldBlock: intent =>
      (intent.leavesBoundary && hasDeactivationGuards(router.routerState.snapshot)) ||
      blockers.list().some(blocker => blocker.shouldBlock(intent)),

    // A guard cannot answer synchronously, so only blockers that asked for the prompt get it.
    shouldBlockUnload: () => blockers.list().some(blocker => blocker.shouldBlockUnload?.() ?? true),

    confirm: async intent => {
      const answered = new AbortController()
      try {
        return await Promise.race([
          askEveryone(intent),
          whenDisposed(context.signal, answered.signal),
        ])
      } finally {
        answered.abort()
      }
    },
  }

  return context.runtime.navigator.registerBlocker(context.mountToken, delegate)
}
