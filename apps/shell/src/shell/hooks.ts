/**
 * Shell hooks over the runtime.
 *
 * Separate from the components that use them because React Refresh only treats
 * a module as a hot-update boundary when every one of its exports is a
 * component. A single exported hook beside a component makes the whole module
 * ineligible, and the update propagates up to the entry — which is a full page
 * reload, the thing HMR exists to avoid.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useMfeRuntime, type NeutralRegistryEntry } from '@company/mfe-react'

import { getLayout, subscribeLayout, type DashboardLayout } from './dashboard/layout-store.ts'
import { shellUi, type ShellSurface } from './ui-store.ts'

/** Registered Apps, in registry order. Widgets own no URL; hidden ones opt out. */
export function useApps(): readonly NeutralRegistryEntry[] {
  const runtime = useMfeRuntime('the shell app finder')
  return useMemo(
    () =>
      [...runtime.registry.entries.values()].filter(
        entry => entry.definitionKind === 'app' && entry.hidden !== true,
      ),
    [runtime],
  )
}

/** Registered Widgets — what the dashboard catalogue offers. */
export function useWidgets(): readonly NeutralRegistryEntry[] {
  const runtime = useMfeRuntime('the shell widget catalogue')
  return useMemo(
    () =>
      [...runtime.registry.entries.values()].filter(
        entry => entry.definitionKind === 'widget' && entry.hidden !== true,
      ),
    [runtime],
  )
}

/**
 * Every application's capability pages, flattened with the application that
 * published each one. The shell knows a settings page exists and where it
 * opens; it has never seen what is on it.
 */
export function useCapabilityPages(): readonly {
  readonly app: NeutralRegistryEntry
  readonly name: string
  readonly label: string
  readonly path: string
}[] {
  const apps = useApps()
  return useMemo(
    () =>
      apps.flatMap(app =>
        (app.capabilities ?? []).map(capability => ({
          app,
          name: capability.name,
          label: capability.label ?? capability.name,
          path: capability.path,
        })),
      ),
    [apps],
  )
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

/** The dashboard canvas, wherever it is read from — the page, or the palette. */
export function useDashboardLayout(): DashboardLayout {
  return useSyncExternalStore(subscribeLayout, getLayout, getLayout)
}

export function useTheme(): 'light' | 'dark' {
  const runtime = useMfeRuntime('the shell theme')
  const subscribe = useCallback(
    (listener: () => void) => runtime.shellState.subscribeToField('theme', listener),
    [runtime],
  )
  return useSyncExternalStore(subscribe, runtime.shellState.getTheme, runtime.shellState.getTheme)
}
