/**
 * TanStack's `useBlocker`, extended to the navigations an App does not own.
 *
 * An App's router blocks the navigations it performs itself, because they go
 * through its own history. The ones that actually lose unsaved work usually do
 * not: a link in the shell's chrome, another application in the finder, the
 * browser's back button. Those move the *shell's* router, and the App's
 * blockers never hear about them.
 *
 * So the mount registers one delegate with the host's navigator and puts the
 * shell's navigation to the App's own blockers, in their own language. The
 * author writes nothing framework-specific — `useBlocker` is the whole API —
 * and the intent arrives as an ordinary `shouldBlockFn` call with `current`,
 * `next` and `action` resolved against the App's route tree.
 */

import { useEffect } from 'react'
import type { HistoryLocation } from '@tanstack/react-router'
import type { BoundaryLocation, NavigationAction } from '@company/mfe-core'
import type { NavigationBlocker } from '@company/mfe-host'

import type { BoundaryHistory, RouterBlocker } from './boundary-history.ts'
import type { MfeMount } from './runtime.ts'

/** A navigation nobody classified is an ordinary link click. */
const DEFAULT_ACTION: NavigationAction = 'PUSH'

/**
 * The shape `blockerFn` expects. The shell deals in boundary locations — a
 * path, a search and a hash — and the router needs a history location, so the
 * position is carried over from the history rather than invented.
 */
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
 * Resolves if the mount is disposed while it still owes the host an answer.
 *
 * A `withResolver` blocker answers when the author's dialog is answered, and a
 * mount that is torn down first — a revoked session, a failed container, a hot
 * reload — never answers at all. The host would then wait forever and refuse
 * every later navigation as "already negotiating", so a disposed mount is read
 * as having no objection: it is gone, along with whatever it was protecting.
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

/**
 * Registers the mount as a navigation blocker, answering out of whatever its
 * router has registered at the moment it is asked.
 *
 * The delegate is registered for the mount's whole life rather than only while
 * a blocker exists, because the set it reads churns: an author writing
 * `shouldBlockFn: () => isDirty` hands `useBlocker` a new function on every
 * render, and TanStack unregisters and re-registers each time. Anything keyed
 * on that set being non-empty, or on one blocker's identity, is therefore
 * unreliable — so both questions the host asks are answered by reading the set
 * at the time of the question.
 */
export function useRouterBlockerBridge(boundary: BoundaryHistory, mount: MfeMount): void {
  useEffect(() => {
    const delegate: NavigationBlocker = {
      depth: mount.depth,

      // Cheap and synchronous, as the host's contract requires: whether this
      // App has anything registered at all. Whether any of them objects to
      // *this* navigation is the author's `shouldBlockFn`, which may be async
      // and may draw a dialog, so it belongs in `confirm`.
      shouldBlock: () => boundary.getBlockers().length > 0,

      shouldBlockUnload: () => boundary.getBlockers().some(wantsUnloadPrompt),

      confirm: async intent => {
        const index = boundary.history.location.state.__TSR_index
        const args = {
          currentLocation: toHistoryLocation(intent.from, index),
          nextLocation: toHistoryLocation(intent.to, index),
          action: intent.action ?? DEFAULT_ACTION,
        }

        // In registration order, and the first refusal ends it — the same order
        // TanStack uses for a navigation through the App's own history.
        const askEveryone = async (): Promise<'proceed' | 'reset'> => {
          for (const blocker of boundary.getBlockers()) {
            const blocked: unknown = await blocker.blockerFn(args)
            if (blocked === true) return 'reset'
          }
          return 'proceed'
        }

        const answered = new AbortController()
        try {
          return await Promise.race([askEveryone(), whenDisposed(mount.signal, answered.signal)])
        } finally {
          answered.abort()
        }
      },
    }

    return mount.runtime.navigator.registerBlocker(mount.mountToken, delegate)
  }, [boundary, mount])
}
