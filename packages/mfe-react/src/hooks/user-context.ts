import { useMemo, useSyncExternalStore } from 'react'
import {
  createUserContextSelection,
  UserContextError,
  type UserContextReader,
  type UserContextStore,
} from '@company/mfe-core/user-context'
import { useMfeMount } from '../mount-context.tsx'

export type {
  UserContextReader,
  UserContextStore,
  UserContextSetter,
} from '@company/mfe-core/user-context'

/** Generated per definition; selectors subscribe only to the paths they read. */
export function createUserContextBindings<
  V,
  Reads extends Record<string, unknown> = Record<never, never>,
>(definitionId: string) {
  function useUserContext<T>(
    selector: (context: Readonly<V>) => T,
  ): readonly [T, UserContextStore<V>['set']]
  function useUserContext<O extends keyof Reads & string, T>(
    ownerId: O,
    selector: (context: Readonly<Reads[O]>) => T,
  ): readonly [T]
  function useUserContext(
    selectorOrOwner: unknown,
    foreignSelector?: unknown,
  ): readonly [unknown] | readonly [unknown, UserContextStore<V>['set']] {
    const mount = useMfeMount('useUserContext()')
    const ownerId = typeof selectorOrOwner === 'string' ? selectorOrOwner : undefined
    const selector = ownerId === undefined ? selectorOrOwner : foreignSelector
    if (
      mount.definitionId !== definitionId ||
      !mount.userContext ||
      (ownerId !== undefined && !mount.resolveUserContext) ||
      typeof selector !== 'function'
    )
      throw new UserContextError(
        'unsupported-contract',
        definitionId,
        'Use the generated binding with a selector for this mounted definition',
      )
    const store = (
      ownerId === undefined ? mount.userContext : mount.resolveUserContext?.(ownerId)
    ) as UserContextReader<V>
    const selection = useMemo(
      () => createUserContextSelection(store, selector as (context: Readonly<V>) => unknown),
      [store, selector],
    )
    const value = useSyncExternalStore(
      selection.subscribe,
      selection.getSnapshot,
      selection.getSnapshot,
    )
    const set = useMemo(
      () => (ownerId === undefined ? (store as UserContextStore<V>).set.bind(store) : undefined),
      [ownerId, store],
    )
    // The selected value is part of the return identity so React Compiler can safely memoize it.
    return useMemo(
      () => (set === undefined ? ([value] as const) : ([value, set] as const)),
      [set, value],
    )
  }
  return { useUserContext }
}
