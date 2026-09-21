/**
 * Blocking a navigation from inside a mount with no router of its own; an App uses TanStack's
 * own `useBlocker` instead (§20). The pending intent is handed back rather than taken as a
 * boolean callback, so the mount renders its own confirmation instead of `window.confirm`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NavigationIntent } from '@company/mfe-core'

import { useMfeMount } from '../mount-context.tsx'

/** Decides, per navigation, whether this mount wants to be asked. */
export type ShouldBlockNavigation = boolean | ((intent: NavigationIntent) => boolean)

export interface NavigationBlock {
  /** The navigation waiting on an answer; the mount stays mounted while it is set. */
  readonly pending: NavigationIntent | null
  readonly proceed: () => void
  readonly stay: () => void
}

/**
 * Registers this mount as a navigation blocker for as long as it is rendered; inside an App,
 * prefer TanStack's own `useBlocker`, which covers the App's own routes too (§20).
 */
export function useNavigationBlock(shouldBlock: ShouldBlockNavigation): NavigationBlock {
  const mount = useMfeMount('useNavigationBlock')
  const [pending, setPending] = useState<NavigationIntent | null>(null)

  /** Read at negotiation time, so a changing answer never re-registers mid-negotiation. */
  const predicate = useRef(shouldBlock)
  useEffect(() => {
    predicate.current = shouldBlock
  })

  const answer = useRef<((decision: 'proceed' | 'reset') => void) | null>(null)

  useEffect(() => {
    const unregister = mount.runtime.navigator.registerBlocker(mount.mountToken, {
      depth: mount.depth,

      shouldBlock: intent => {
        const current = predicate.current
        return typeof current === 'function' ? current(intent) : current
      },

      // A reload has no intent to hand the predicate, so a per-navigation mount is asked
      // for the prompt and a plain boolean is taken at its word (§20).
      shouldBlockUnload: () => {
        const current = predicate.current
        return typeof current === 'function' ? true : current
      },

      confirm: intent =>
        new Promise<'proceed' | 'reset'>(resolve => {
          answer.current = resolve
          setPending(intent)
        }),
    })

    return () => {
      unregister()
      // A mount that vanishes mid-negotiation still owes an answer, or the host refuses
      // every later navigation as "already negotiating".
      answer.current?.('proceed')
      answer.current = null
    }
  }, [mount])

  const settle = useCallback((decision: 'proceed' | 'reset') => {
    answer.current?.(decision)
    answer.current = null
    setPending(null)
  }, [])

  const proceed = useCallback(() => {
    settle('proceed')
  }, [settle])

  const stay = useCallback(() => {
    settle('reset')
  }, [settle])

  return { pending, proceed, stay }
}
