/**
 * Shell hooks over the runtime.
 *
 * Separate from the components that use them because React Refresh only treats
 * a module as a hot-update boundary when every one of its exports is a
 * component. A single exported hook beside a component makes the whole module
 * ineligible, and the update propagates up to the entry — which is a full page
 * reload, the thing HMR exists to avoid.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { useLocation } from '@tanstack/react-router'
import {
  useActiveDefinition,
  useStoredState,
  type ActiveDefinition,
  type StoredStateSetter,
} from '@company/mfe-react'

import {
  DashboardLayoutSchema,
  EMPTY_LAYOUT,
  migrateLayout,
  type DashboardLayout,
} from './dashboard/layout-store.ts'
import { shellUi, type ShellSurface } from './ui-store.ts'

/**
 * Which application the chrome is currently showing, or `null` on the shell's
 * own page.
 *
 * Read from the route rather than remembered on a selection, because the URL is
 * what decides: a deep link, a browser back and a click in the finder all have
 * to arrive at the same answer. The shell supplies the path because the router
 * above it is the shell's; the framework says what a path means, which is the
 * same derivation it gives a mounted App's navigation blocker about the same
 * URL — so the chrome and the boundary cannot disagree about which application
 * is on screen.
 */
export function useActiveApp(): ActiveDefinition | null {
  const pathname = useLocation({ select: location => location.pathname })
  return useActiveDefinition(pathname)
}

/**
 * True below the `lg` breakpoint, where the shell's own page has one column
 * instead of three. A media query rather than a width: it re-evaluates when the
 * window is resized, and it is the same breakpoint the layout uses.
 */
export function useIsCompact(): boolean {
  const subscribe = useCallback((listener: () => void) => {
    const query = window.matchMedia('(max-width: 1023px)')
    query.addEventListener('change', listener)
    return () => {
      query.removeEventListener('change', listener)
    }
  }, [])

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia('(max-width: 1023px)').matches,
    // Nothing renders on a server here, but the snapshot is required and
    // "not compact" is the layout the markup already describes.
    () => false,
  )
}

/** Which shell surface is open, for the chrome that renders them. */
export function useShellSurface(): ShellSurface | null {
  return useSyncExternalStore(shellUi.subscribe, shellUi.getSnapshot, shellUi.getSnapshot)
}

/**
 * The dashboard canvas, wherever it is read from — the page, the palette, or
 * settings. All three bind the same key, so all three share one record and one
 * subscription: a Widget added from the palette is on the canvas already.
 */
export function useDashboardLayout(): readonly [
  DashboardLayout,
  StoredStateSetter<DashboardLayout>,
] {
  return useStoredState('dashboard', DashboardLayoutSchema, {
    defaultValue: EMPTY_LAYOUT,
    retention: 'browser',
    migrate: migrateLayout,
  })
}
