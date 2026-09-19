/**
 * Blocking a navigation the mount would lose, from inside the mount.
 *
 * The case is always the same: an editor with unsaved changes, and a
 * navigation — a link in the shell's own chrome, another application in the
 * finder, the browser's back button — that would discard them. The mount is the
 * only thing that knows the edits exist, and it is also the only thing that can
 * ask about them in its own language, so the host asks and the mount answers.
 *
 * The shape is deliberately not a `window.confirm`. `confirm()` is synchronous,
 * unstyled, unusable on a phone and impossible to test; the mount instead
 * renders its own dialog and resolves the decision, which is why this hook
 * hands back a pending intent rather than taking a callback that returns a
 * boolean.
 *
 * Ordering across nested mounts is the host's: innermost first, stopping at the
 * first refusal, so an inner editor is never overruled by the App around it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NavigationIntent } from '@company/mfe-core'

import { useMfeMount } from '../mount-context.tsx'

/** Decides, per navigation, whether this mount wants to be asked. */
export type ShouldBlockNavigation = boolean | ((intent: NavigationIntent) => boolean)

export interface NavigationBlock {
  /**
   * The navigation waiting on an answer, or `null`. Render your own
   * confirmation while this is set — the mount stays mounted throughout, so its
   * UI is still usable and the edits are still there to be saved.
   */
  readonly pending: NavigationIntent | null
  /** Let the navigation continue. Anything unsaved is discarded by it. */
  readonly proceed: () => void
  /** Refuse: the navigation is abandoned and this mount keeps the page. */
  readonly stay: () => void
}

/**
 * Registers this mount as a navigation blocker for as long as it is rendered.
 *
 * ```tsx
 * const block = useNavigationBlock(isDirty)
 * // …
 * <AlertDialog isOpen={block.pending !== null}>
 *   <Button onPress={block.stay}>Keep editing</Button>
 *   <Button onPress={block.proceed}>Discard changes</Button>
 * </AlertDialog>
 * ```
 */
export function useNavigationBlock(shouldBlock: ShouldBlockNavigation): NavigationBlock {
  const mount = useMfeMount('useNavigationBlock')
  const [pending, setPending] = useState<NavigationIntent | null>(null)

  /**
   * Read at negotiation time rather than captured at registration: the whole
   * point is that the answer changes as the user types, and a registration that
   * re-ran on every keystroke would re-enter the host's blocker map mid-flight.
   *
   * Published after the commit, like `useCommand` does, so nothing is written
   * during render.
   */
  const predicate = useRef(shouldBlock)
  useEffect(() => {
    predicate.current = shouldBlock
  })

  /** The decision this mount owes the host, if it has been asked. */
  const answer = useRef<((decision: 'proceed' | 'reset') => void) | null>(null)

  useEffect(() => {
    const unregister = mount.runtime.navigator.registerBlocker(mount.mountToken, {
      depth: mount.depth,

      shouldBlock: intent => {
        const current = predicate.current
        return typeof current === 'function' ? current(intent) : current
      },

      confirm: intent =>
        new Promise<'proceed' | 'reset'>(resolve => {
          answer.current = resolve
          setPending(intent)
        }),
    })

    return () => {
      unregister()
      // A mount that disappears mid-negotiation still owes an answer: the host
      // is awaiting this promise and would otherwise refuse every later
      // navigation as "already negotiating". It is gone, so it cannot object.
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
