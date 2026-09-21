/**
 * The framework-owned boundary history, one per App mount, built over the navigation bridge
 * instead of with `createBrowserHistory`, which patches `window.history` (§1).
 */

import { createHistory, type BlockerFn, type RouterHistory } from '@tanstack/react-router'
import type { BoundaryLocation, NavigationBridge } from '@company/mfe-core'

/** Where the history keeps its position, so back and forward stay distinguishable. */
const INDEX_KEY = '__TSR_index'

/** Named here because the host reads these back for navigations the router never sees (§20). */
export interface RouterBlocker {
  readonly blockerFn: BlockerFn
  readonly enableBeforeUnload?: boolean | (() => boolean)
}

export interface BoundaryHistory {
  readonly history: RouterHistory
  /** Whatever the App's router has registered, in registration order. */
  readonly getBlockers: () => readonly RouterBlocker[]
  /**
   * Shaped for an effect: a subscription made in the constructor is removed by the first
   * cleanup and never re-made (§14).
   */
  readonly attach: () => () => void
}

function readIndex(state: unknown): number | null {
  if (state === null || typeof state !== 'object') return null
  const value = (state as Record<string, unknown>)[INDEX_KEY]
  return typeof value === 'number' ? value : null
}

/**
 * Carries full paths, not boundary-relative ones, because TanStack Router strips the
 * `basepath` itself. Construction is pure, so a memo React double-invokes is safe (§1).
 */
export function createBoundaryHistory(bridge: NavigationBridge): BoundaryHistory {
  /** Our view of the current position, used to classify external navigations. */
  let index = readIndex(bridge.readState?.()) ?? 0

  /** Owned here because the shell also asks them about navigations this history never sees. */
  let blockers: readonly RouterBlocker[] = []

  const history: RouterHistory = createHistory({
    getLocation: () => {
      const location: BoundaryLocation = bridge.read()
      return {
        href: `${location.pathname}${location.search}${location.hash}`,
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        state: { ...(bridge.readState?.() as object | undefined), [INDEX_KEY]: index },
      }
    },

    getLength: () => index + 1,

    pushState: (path, state) => {
      index = readIndex(state) ?? index + 1
      bridge.push(path, state)
    },

    replaceState: (path, state) => {
      index = readIndex(state) ?? index
      bridge.replace(path, state)
    },

    go: delta => {
      if (bridge.go) {
        bridge.go(delta)
        return
      }
      // Without `go` on the bridge the nearest single step is taken, rather than none.
      if (delta < 0) bridge.back()
      else if (delta > 0) bridge.forward()
    },

    back: () => bridge.back(),
    forward: () => bridge.forward(),
    createHref: path => path,

    getBlockers: () => [...blockers],
    setBlockers: next => {
      blockers = [...next]
    },
  })

  return {
    history,

    getBlockers: () => blockers,

    // The bridge reports only navigations the framework did not initiate; `createHistory`
    // already notifies for its own push and replace.
    attach: () =>
      bridge.subscribe(() => {
        const nextIndex = readIndex(bridge.readState?.())
        const delta = nextIndex === null ? -1 : nextIndex - index
        if (nextIndex !== null) index = nextIndex

        if (delta === -1) history.notify({ type: 'BACK' })
        else if (delta === 1) history.notify({ type: 'FORWARD' })
        else history.notify({ type: 'GO', index: delta })
      }),
  }
}
