/**
 * The framework-owned boundary history, one per App mount.
 *
 * Deliberately NOT `createBrowserHistory()`: that helper reassigns
 * `window.history.pushState` and `replaceState`, the global History patch this
 * framework removed from the old shell — it breaks anything else wrapping them
 * and is what made two routers on one page fight over the URL. `createHistory()`
 * is the supported seam for a different backing store, so the history is built
 * over the explicit navigation bridge and no global is touched. Blockers still
 * work natively, because `createHistory` consults the ones it is given.
 */

import { createHistory, type RouterHistory } from '@tanstack/react-router'
import type { BoundaryLocation, NavigationBridge } from '@company/mfe-core'

/** Where the history keeps its position, so back and forward stay distinguishable. */
const INDEX_KEY = '__TSR_index'

export interface BoundaryHistory {
  readonly history: RouterHistory
  /** Detaches the bridge subscription and the underlying history. */
  readonly dispose: () => void
}

function readIndex(state: unknown): number | null {
  if (state === null || typeof state !== 'object') return null
  const value = (state as Record<string, unknown>)[INDEX_KEY]
  return typeof value === 'number' ? value : null
}

/**
 * The history carries full paths rather than boundary-relative ones: TanStack
 * Router strips the `basepath` itself, so a pre-stripped path would lose its
 * prefix twice.
 */
export function createBoundaryHistory(bridge: NavigationBridge): BoundaryHistory {
  /** Our view of the current position, used to classify external navigations. */
  let index = readIndex(bridge.readState?.()) ?? 0

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
      // Without `go` on the bridge only single-step traversal is supported.
      // Doing nothing for a larger jump would strand the router, so the nearest
      // single step is taken; the limitation is documented rather than hidden.
      if (delta < 0) bridge.back()
      else if (delta > 0) bridge.forward()
    },

    back: () => bridge.back(),
    forward: () => bridge.forward(),
    createHref: path => path,
  })

  // The bridge reports only navigations the framework did not initiate — browser
  // back and forward, shell-driven boundary changes — because `createHistory`
  // already notifies for its own push and replace. They are classified from the
  // position delta the way a browser history does.
  const unsubscribe = bridge.subscribe(() => {
    const nextIndex = readIndex(bridge.readState?.())
    const delta = nextIndex === null ? -1 : nextIndex - index
    if (nextIndex !== null) index = nextIndex

    if (delta === -1) history.notify({ type: 'BACK' })
    else if (delta === 1) history.notify({ type: 'FORWARD' })
    else history.notify({ type: 'GO', index: delta })
  })

  return {
    history,
    dispose: () => {
      unsubscribe()
      history.destroy()
    },
  }
}
