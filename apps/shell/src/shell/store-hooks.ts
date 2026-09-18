/**
 * Reading the shell-owned stores from React.
 *
 * Every store on the runtime publishes `getSnapshot` and `subscribe` as stable
 * references, which is exactly what `useSyncExternalStore` wants: no wrapper
 * state, no effect, and no tearing while an MFE registers or disposes.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import {
  useMfeRuntime,
  type BreadcrumbItem,
  type MfeRuntime,
  type ShellTheme,
  type ShellUser,
} from '@company/mfe-react'

/**
 * The published command entry, derived from the store rather than imported: the
 * neutral contract package is framework-internal and off-limits to consumers.
 */
export type CommandEntry = ReturnType<MfeRuntime['commands']['getSnapshot']>[number]

/** The composed breadcrumb trail. The shell renders it; it never computes it. */
export function useBreadcrumbTrail(): readonly BreadcrumbItem[] {
  const runtime = useMfeRuntime('the shell breadcrumbs')
  return useSyncExternalStore(
    runtime.breadcrumbs.subscribe,
    runtime.breadcrumbs.getSnapshot,
    runtime.breadcrumbs.getSnapshot,
  )
}

/** Every command registered by a live mount, with its latest decision. */
export function useCommandEntries(): readonly CommandEntry[] {
  const runtime = useMfeRuntime('the shell command palette')
  return useSyncExternalStore(
    runtime.commands.subscribe,
    runtime.commands.getSnapshot,
    runtime.commands.getSnapshot,
  )
}

export function useShellTheme(): ShellTheme {
  const runtime = useMfeRuntime('the shell theme toggle')
  const subscribe = useCallback(
    (listener: () => void) => runtime.shellState.subscribeToField('theme', listener),
    [runtime],
  )
  return useSyncExternalStore(subscribe, runtime.shellState.getTheme, runtime.shellState.getTheme)
}

export function useShellUser(): ShellUser | null {
  const runtime = useMfeRuntime('the shell user menu')
  const subscribe = useCallback(
    (listener: () => void) => runtime.shellState.subscribeToField('user', listener),
    [runtime],
  )
  return useSyncExternalStore(subscribe, runtime.shellState.getUser, runtime.shellState.getUser)
}

/**
 * Publishes the shell's own portion of the breadcrumb trail.
 *
 * The shell contributes at depth 0 — the workspace root and, once a boundary is
 * active, the App the registry says is mounted there. A mounted App contributes
 * at depth 1 and the store composes the two parent-to-child, so the header
 * still renders one snapshot from one source.
 */
export function useShellBreadcrumbContribution(items: readonly BreadcrumbItem[]): void {
  const runtime: MfeRuntime = useMfeRuntime('the shell breadcrumbs')
  const handle = useRef<ReturnType<MfeRuntime['breadcrumbs']['registerMount']> | null>(null)

  useEffect(() => {
    const registration = runtime.breadcrumbs.registerMount('shell', SHELL_MOUNT_TOKEN, 0)
    handle.current = registration
    return () => {
      handle.current = null
      registration.remove()
    }
  }, [runtime])

  useEffect(() => {
    handle.current?.update(items)
  }, [items])
}

/**
 * The shell is not a mount, but the breadcrumb store keys contributions by
 * token, so it needs one. It is fixed: there is exactly one shell.
 */
const SHELL_MOUNT_TOKEN = 'shell#0'
