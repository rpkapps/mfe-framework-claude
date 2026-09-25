/**
 * Shell hooks over the runtime, kept apart from the components that use them because React
 * Refresh only replaces a module whose every export is a component (§18).
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import {
  useActiveDefinition,
  useMfeRuntime,
  useStoredState,
  useTheme,
  type ActiveDefinition,
  type StoredStateSetter,
} from '@company/mfe-react'
import type { ActionRegistrationHandle } from '@company/mfe-react/host'

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
import { shellActions } from './shell-actions.ts'
import { shellUi, type ShellSurface } from './ui-store.ts'

/**
 * Which application the chrome is showing, derived from the pathname the shell hands the
 * framework rather than remembered on a selection, so the chrome and the boundary agree (§26).
 */
export function useActiveApp(): ActiveDefinition | null {
  const pathname = useLocation({ select: location => location.pathname })
  return useActiveDefinition(pathname)
}

/**
 * Tells mounted Apps where the shell's own router took the page. It pushes to the browser
 * directly — from the palette, the settings sheet, a breadcrumb — and the browser reports only
 * `popstate`, so without this an App would stay where it was while the URL moved. Keyed by the
 * history entry rather than the href, so going to the URL the shell already shows still counts;
 * the navigator emits only when the page is somewhere its Apps were not told of.
 */
export function useAnnounceShellNavigation(): void {
  const runtime = useMfeRuntime('the shell navigation')
  const entry = useLocation({ select: location => location.state.__TSR_key ?? location.href })

  useEffect(() => {
    runtime.navigator.announce()
  }, [runtime, entry])
}

/**
 * The page's one key listener. Every shortcut is an action's, the shell's and a mounted App's
 * alike, and the runtime decides which of them the key means; an App renders in a React root of
 * its own, so a listener or a registry provided through the shell's tree would never reach it.
 */
export function useActionShortcuts(): void {
  const runtime = useMfeRuntime('the shell keyboard')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      runtime.actions.handleKeyDown(event)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [runtime])
}

/**
 * Registers the shell's own actions in the host page's scope for as long as the runtime lives,
 * then re-applies them after every commit: the registry publishes only what visibly changed, so a
 * label that follows the theme updates and a new closure alone does not.
 */
export function useShellActions(): void {
  const runtime = useMfeRuntime('the shell actions')
  const navigate = useNavigate()
  const theme = useTheme()
  const [layout, setLayout] = useDashboardLayout()
  const registrations = shellActions({
    runtime,
    theme,
    layout,
    setLayout,
    goToDashboard: () => void navigate({ to: '/' }),
  })

  const latest = useRef(registrations)
  const handles = useRef<readonly ActionRegistrationHandle[]>([])

  useEffect(() => {
    const registered = latest.current.map(registration =>
      runtime.actions.registerHost(registration),
    )
    handles.current = registered
    return () => {
      handles.current = []
      for (const handle of registered) handle.remove()
    }
  }, [runtime])

  useEffect(() => {
    latest.current = registrations
    registrations.forEach((registration, index) => {
      handles.current[index]?.update(registration)
    })
  })
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
