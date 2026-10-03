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
  type ActiveDefinition,
  type StoredKey,
  type StoredUpdate,
} from '@company/mfe-react'
import type { ActionRegistrationHandle } from '@company/mfe-react/host'

import { assistantWidthKey, dashboardKey, dashboardPanelsKey, snapToTopKey } from '../storage.ts'
import type { DashboardLayout } from './dashboard/layout-store.ts'
import type { PanelLayout } from './dashboard/panels-store.ts'
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
  const [layout, setLayout] = useDashboardLayout()
  const registrations = shellActions({
    runtime,
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

/**
 * Writes a browser-stored value and moves on: a local write settles at once, and a refused one
 * (a full quota) shows in the key's status instead of failing the caller.
 */
export type StoredSetter<T> = (next: StoredUpdate<T>) => void

function useStoredValue<T>(key: StoredKey<T>): readonly [T, StoredSetter<T>] {
  const stored = useStoredState(key)
  // Stable, as the hook's own `set` is, so a caller can list it in its dependencies.
  const latest = useRef(stored)
  useEffect(() => {
    latest.current = stored
  })
  const write = useCallback<StoredSetter<T>>(next => {
    latest.current.set(next).catch(() => undefined)
  }, [])
  return [stored.value, write]
}

/** One key for every reader, so a Widget added from the palette is already on the canvas the page renders. */
export function useDashboardLayout(): readonly [DashboardLayout, StoredSetter<DashboardLayout>] {
  return useStoredValue(dashboardKey)
}

/** The split between catalogue, canvas and activity, remembered across reloads like the tiles. */
export function useDashboardPanels(): readonly [PanelLayout, StoredSetter<PanelLayout>] {
  return useStoredValue(dashboardPanelsKey)
}

/** The width, in pixels, the user last dragged the assistant to; null until they do. */
export function useAssistantWidth(): readonly [number | null, StoredSetter<number | null>] {
  return useStoredValue(assistantWidthKey)
}

/** Whether the canvas lifts its tiles to the top when a drag is released. */
export function useSnapToTop(): readonly [boolean, StoredSetter<boolean>] {
  return useStoredValue(snapToTopKey)
}
