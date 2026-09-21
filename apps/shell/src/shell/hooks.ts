/**
 * Shell hooks over the runtime, kept apart from the components that use them because React
 * Refresh only replaces a module whose every export is a component (§18).
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
import {
  DEFAULT_PANELS,
  migratePanels,
  PanelLayoutSchema,
  SNAP_TO_TOP_DEFAULT,
  SnapToTopSchema,
  type PanelLayout,
} from './dashboard/panels-store.ts'
import { shellUi, type ShellSurface } from './ui-store.ts'

/**
 * Which application the chrome is showing, derived from the pathname the shell hands the
 * framework rather than remembered on a selection, so the chrome and the boundary agree (§26).
 */
export function useActiveApp(): ActiveDefinition | null {
  const pathname = useLocation({ select: location => location.pathname })
  return useActiveDefinition(pathname)
}

/** A media query rather than a width, so it re-evaluates on resize at the breakpoint the layout uses. */
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
    // Nothing renders on a server here, but `useSyncExternalStore` requires the snapshot.
    () => false,
  )
}

export function useShellSurface(): ShellSurface | null {
  return useSyncExternalStore(shellUi.subscribe, shellUi.getSnapshot, shellUi.getSnapshot)
}

/** One key for every reader, so a Widget added from the palette is already on the canvas the page renders. */
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

/** The split between catalogue, canvas and activity, remembered across reloads like the tiles. */
export function useDashboardPanels(): readonly [PanelLayout, StoredStateSetter<PanelLayout>] {
  return useStoredState('dashboard-panels', PanelLayoutSchema, {
    defaultValue: DEFAULT_PANELS,
    retention: 'browser',
    migrate: migratePanels,
  })
}

/** Whether the canvas lifts its tiles to the top when a drag is released. */
export function useSnapToTop(): readonly [boolean, StoredStateSetter<boolean>] {
  return useStoredState('dashboard-snap', SnapToTopSchema, {
    defaultValue: SNAP_TO_TOP_DEFAULT,
    retention: 'browser',
  })
}
