/**
 * Blocking a navigation the mount does not own. The pending intent is handed back as a signal
 * rather than taken as a boolean callback, so the mount renders its own confirmation instead of
 * `window.confirm`. Inside an App, a route's `canDeactivate` guard also covers the App's own
 * routes; this is for a Widget, and for state no single route owns.
 */

import {
  assertInInjectionContext,
  DestroyRef,
  inject,
  isSignal,
  signal,
  type Signal,
} from '@angular/core'
import type { NavigationIntent } from '@company/mfe-core'

import {
  APP_NAVIGATION_BLOCKERS,
  type MountNavigationBlocker,
} from '../routing/navigation-blockers.ts'
import { injectMfeMount } from './runtime.ts'

/** Decides, per navigation, whether this mount wants to be asked; read at negotiation time. */
export type ShouldBlockNavigation =
  | boolean
  | Signal<boolean>
  | ((intent: NavigationIntent) => boolean)

export interface NavigationBlockOptions {
  /**
   * Whether the browser's reload prompt is offered while this blocker is active. A reload has no
   * intent to hand a predicate, so a predicate counts as active; defaults to `true`.
   */
  readonly unloadPrompt?: boolean
}

export interface NavigationBlock {
  /** The navigation waiting on an answer; the mount stays mounted while it is set. */
  readonly pending: Signal<NavigationIntent | null>
  proceed(): void
  stay(): void
}

export function injectNavigationBlock(
  shouldBlock: ShouldBlockNavigation,
  options: NavigationBlockOptions = {},
): NavigationBlock {
  assertInInjectionContext(injectNavigationBlock)

  const mount = injectMfeMount('injectNavigationBlock()')
  const appBlockers = inject(APP_NAVIGATION_BLOCKERS, { optional: true })
  const pending = signal<NavigationIntent | null>(null)
  let answer: ((decision: 'proceed' | 'reset') => void) | null = null

  const blocks = (intent: NavigationIntent | null): boolean => {
    if (isSignal(shouldBlock)) return shouldBlock()
    if (typeof shouldBlock === 'function') return intent === null || shouldBlock(intent)
    return shouldBlock
  }

  const blocker: MountNavigationBlocker = {
    shouldBlock: intent => blocks(intent),
    shouldBlockUnload: () => options.unloadPrompt !== false && blocks(null),
    confirm: intent =>
      new Promise<'proceed' | 'reset'>(resolve => {
        answer = resolve
        pending.set(intent)
      }),
  }

  // Inside an App the mount's one delegate asks this after the App's own guards; a Widget has no
  // delegate, so it registers with the navigator directly.
  const unregister =
    appBlockers === null
      ? mount.runtime.navigator.registerBlocker(mount.mountToken, {
          depth: mount.depth,
          ...blocker,
        })
      : appBlockers.add(blocker)

  const settle = (decision: 'proceed' | 'reset'): void => {
    answer?.(decision)
    answer = null
    pending.set(null)
  }

  inject(DestroyRef).onDestroy(() => {
    unregister()
    // A mount that vanishes mid-negotiation still owes an answer, or the host refuses every later
    // navigation as "already negotiating".
    answer?.('proceed')
    answer = null
  })

  return {
    pending: pending.asReadonly(),
    proceed: () => {
      settle('proceed')
    },
    stay: () => {
      settle('reset')
    },
  }
}
