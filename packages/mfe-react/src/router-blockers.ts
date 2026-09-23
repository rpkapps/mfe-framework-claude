/**
 * TanStack's `useBlocker`, extended to the navigations an App does not own: the mount
 * registers one delegate with the host's navigator and answers it out of the App's own
 * blockers (§20).
 */

import { useEffect } from 'react'
import type { HistoryLocation } from '@tanstack/react-router'
import type { BoundaryLocation, NavigationAction } from '@company/mfe-core'
import { confirmUnlessDisposed, type NavigationBlocker } from '@company/mfe-runtime'

import type { BoundaryHistory, RouterBlocker } from './boundary-history.ts'
import type { MfeMount } from './runtime.ts'

/** A navigation nobody classified is an ordinary link click. */
const DEFAULT_ACTION: NavigationAction = 'PUSH'

/** The shell deals in boundary locations, so the position is carried over rather than invented. */
function toHistoryLocation(location: BoundaryLocation, index: number): HistoryLocation {
  return {
    href: `${location.pathname}${location.search}${location.hash}`,
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    state: { __TSR_index: index },
  }
}

/** TanStack's own default: a blocker offers the unload prompt unless it opts out. */
function wantsUnloadPrompt(blocker: RouterBlocker): boolean {
  const enabled = blocker.enableBeforeUnload ?? true
  return typeof enabled === 'function' ? enabled() : enabled
}

/**
 * Registers the mount as a navigation blocker; the delegate lives as long as the mount because
 * the blocker set churns on every render (§20).
 */
export function useRouterBlockerBridge(boundary: BoundaryHistory, mount: MfeMount): void {
  useEffect(() => {
    const delegate: NavigationBlocker = {
      depth: mount.depth,

      // Cheap and synchronous, as the host's contract requires; whether any blocker objects
      // to *this* navigation may be async, so it belongs in `confirm`.
      shouldBlock: () => boundary.getBlockers().length > 0,

      shouldBlockUnload: () => boundary.getBlockers().some(wantsUnloadPrompt),

      confirm: async intent => {
        const index = boundary.history.location.state.__TSR_index
        const args = {
          currentLocation: toHistoryLocation(intent.from, index),
          nextLocation: toHistoryLocation(intent.to, index),
          action: intent.action ?? DEFAULT_ACTION,
        }

        // In registration order, the same order TanStack uses through the App's own history.
        const askEveryone = async (): Promise<'proceed' | 'reset'> => {
          for (const blocker of boundary.getBlockers()) {
            const blocked: unknown = await blocker.blockerFn(args)
            if (blocked === true) return 'reset'
          }
          return 'proceed'
        }

        return await confirmUnlessDisposed(mount.signal, askEveryone)
      },
    }

    return mount.runtime.navigator.registerBlocker(mount.mountToken, delegate)
  }, [boundary, mount])
}
