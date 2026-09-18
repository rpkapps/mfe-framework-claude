/**
 * The framework-owned boundary history.
 *
 * This is deliberately NOT `createBrowserHistory()`. That helper reassigns
 * `window.history.pushState` and `window.history.replaceState` so it can notice
 * navigations it did not perform. Reassigning those methods is exactly the
 * global History patch this framework removed from the old shell: it is action
 * at a distance, it breaks anything else that wraps them, and with several
 * routers on one page it is what made two routers fight over the URL.
 *
 * `createHistory()` is the supported seam for supplying a different backing
 * store, so the framework builds its history over the explicit navigation
 * bridge instead. The router gets a real, fully functional history — including
 * native blocker support, because `createHistory` consults the blockers it is
 * given — and no global is touched.
 *
 * The App author never sees any of this: they pass the supplied `history`
 * straight into `createRouter`.
 */

import { createHistory, type RouterHistory } from '@tanstack/react-router'
import type { BoundaryLocation, NavigationBridge } from '@company/mfe-core'

/** Where the history keeps its position, so back and forward stay distinguishable. */
const INDEX_KEY = '__TSR_index'

interface IndexedState {
  readonly [INDEX_KEY]: number
}

export interface BoundaryHistory {
  readonly history: RouterHistory
  /** Detaches the bridge subscription and the underlying history. */
  readonly dispose: () => void
}

function toHref(location: BoundaryLocation): string {
  return `${location.pathname}${location.search}${location.hash}`
}

function readIndex(state: unknown): number | null {
  if (state === null || typeof state !== 'object') return null
  const value = (state as Partial<IndexedState>)[INDEX_KEY]
  return typeof value === 'number' ? value : null
}

/**
 * Builds a history bound to one App boundary.
 *
 * The history carries full paths rather than boundary-relative ones: TanStack
 * Router strips the `basepath` itself, so a pre-stripped path would have its
 * prefix removed twice.
 */
export function createBoundaryHistory(bridge: NavigationBridge): BoundaryHistory {
  /** Our view of the current position, used to classify external navigations. */
  let index = readIndex(bridge.readState?.()) ?? 0

  const currentLocation = (): BoundaryLocation => bridge.read()

  const history: RouterHistory = createHistory({
    getLocation: () => {
      const location = currentLocation()
      const href = toHref(location)
      const state = { ...(bridge.readState?.() as object | undefined), [INDEX_KEY]: index }
      return {
        href,
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        state: state as IndexedState & Record<string, unknown>,
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

  /**
   * The bridge reports navigations the framework did not initiate: browser back
   * and forward, and shell-driven boundary changes. `createHistory` already
   * notifies for its own push and replace, so this covers only the external
   * case, classifying it from the position delta the way a browser history
   * does.
   */
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
