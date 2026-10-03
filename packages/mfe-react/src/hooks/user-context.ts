import { use, useMemo, useSyncExternalStore } from 'react'
import {
  createUserContextSelection,
  UserContextError,
  type UserContextReader,
  type UserContextStore,
} from '@company/mfe-core/user-context'
import { useMfeMount, useOptionalMfeMount } from '../mount-context.tsx'
import { useMfeRuntime } from '../runtime-context.tsx'

export type {
  UserContextReader,
  UserContextReadsOf,
  UserContextStore,
  UserContextSetter,
  UserContextValuesOf,
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
        'undeclared',
        definitionId,
        'Use the generated binding with a selector, inside the definition it was generated for',
      )
    const store = (
      ownerId === undefined ? mount.userContext : mount.resolveUserContext?.(ownerId)
    ) as UserContextReader<V>
    return useSelectedUserContext(store, selector, ownerId === undefined)
  }
  return { useUserContext }
}

function useSelectedUserContext<V>(
  store: UserContextReader<V>,
  selector: unknown,
  writable: boolean,
): readonly [unknown] | readonly [unknown, UserContextStore<V>['set']] {
  const selection = useMemo(() => createUserContextSelection(store), [store])
  // Inline selectors are new closures each render; an unchanged result keeps its identity, so
  // React bails out of rendering for commits that leave the selected value as it was.
  const read = (): unknown => selection.read(selector as (context: Readonly<V>) => unknown)
  const value = useSyncExternalStore(selection.subscribe, read, read)
  const set = useMemo(
    () => (writable ? (store as UserContextStore<V>).set.bind(store) : undefined),
    [writable, store],
  )
  // The selected value is part of the return identity so React Compiler can safely memoize it.
  return useMemo(
    () => (set === undefined ? ([value] as const) : ([value, set] as const)),
    [set, value],
  )
}

/** @internal Generated shell binding; application components still call only useUserContext. */
export function createHostUserContextBindings<
  V,
  Reads extends Record<string, unknown> = Record<never, never>,
>() {
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
    const mount = useOptionalMfeMount()
    const host = useMfeRuntime('useUserContext()').userContext?.host
    const ownerId = typeof selectorOrOwner === 'string' ? selectorOrOwner : undefined
    const selector = ownerId === undefined ? selectorOrOwner : foreignSelector
    if (mount || !host || typeof selector !== 'function')
      throw new UserContextError(
        'undeclared',
        host?.id ?? '<shell>',
        'Use the generated shell binding inside its MfeProvider, outside an App or Widget mount, with userContext declared on createMfeRuntime',
      )
    // The runtime prepares the shell's slice like a mount's, once per signed-in user; Suspense
    // waits for it and an error boundary receives a failed load.
    const preparation = useSyncExternalStore(host.subscribe, host.prepared, host.prepared)
    const prepared = use(preparation)
    const store = (
      ownerId === undefined ? prepared.userContext : prepared.resolveUserContext(ownerId)
    ) as UserContextReader<V>
    return useSelectedUserContext(store, selector, ownerId === undefined)
  }
  return { useUserContext }
}
