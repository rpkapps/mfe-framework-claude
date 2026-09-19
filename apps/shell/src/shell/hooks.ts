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

export function useTheme(): 'light' | 'dark' {
  const runtime = useMfeRuntime('the shell theme')
  const subscribe = useCallback(
    (listener: () => void) => runtime.shellState.subscribeToField('theme', listener),
    [runtime],
  )
  return useSyncExternalStore(subscribe, runtime.shellState.getTheme, runtime.shellState.getTheme)
}
