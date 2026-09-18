/**
 * The live shell-state hooks, available in Apps and in independently mounted
 * Widgets alike.
 *
 * Each hook subscribes to exactly one field, so changing the theme cannot
 * notify a consumer that only reads the user. Each accepts an optional selector
 * to narrow the subscription further.
 *
 * These values are readonly data for rendering and UX decisions. They are not
 * an authorization API: the host and backend remain responsible for that.
 */

import { useCallback } from 'react'
import type { ShellTheme, ShellUser } from '@company/mfe-core'
import type { ShellStateField } from '@company/mfe-host'

import { useMfeMount } from '../mount-context.tsx'
import { identitySelector, useStoreSelector, type Selector } from './use-store-selector.ts'

function useShellField<S, T>(
  hookName: string,
  field: ShellStateField,
  read: (store: ReturnType<typeof useMfeMount>['runtime']['shellState']) => S,
  selector: Selector<S, T>,
): T {
  const { runtime } = useMfeMount(hookName)
  const store = runtime.shellState

  const subscribe = useCallback(
    (listener: () => void) => store.subscribeToField(field, listener),
    [store, field],
  )
  const getSnapshot = useCallback(() => read(store), [store, read])

  return useStoreSelector(subscribe, getSnapshot, selector)
}

const readUser = (store: { getUser: () => ShellUser | null }): ShellUser | null => store.getUser()
const readGroups = (store: { getGroups: () => readonly string[] }): readonly string[] =>
  store.getGroups()
const readTheme = (store: { getTheme: () => ShellTheme }): ShellTheme => store.getTheme()

export function useUser(): ShellUser | null
export function useUser<T>(selector: Selector<ShellUser | null, T>): T
export function useUser<T>(
  selector: Selector<ShellUser | null, T> = identitySelector as Selector<ShellUser | null, T>,
): T {
  return useShellField('useUser', 'user', readUser, selector)
}

export function useGroups(): readonly string[]
export function useGroups<T>(selector: Selector<readonly string[], T>): T
export function useGroups<T>(
  selector: Selector<readonly string[], T> = identitySelector as Selector<readonly string[], T>,
): T {
  return useShellField('useGroups', 'groups', readGroups, selector)
}

export function useTheme(): ShellTheme
export function useTheme<T>(selector: Selector<ShellTheme, T>): T
export function useTheme<T>(
  selector: Selector<ShellTheme, T> = identitySelector as Selector<ShellTheme, T>,
): T {
  return useShellField('useTheme', 'theme', readTheme, selector)
}
