import { useCallback, useSyncExternalStore } from 'react'
import {
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

/** Generated per definition; stores remain owned by the mounted runtime and identity scope. */
export function createUserContextBindings<V>(definitionId: string) {
  function useUserContextStore(): UserContextStore<V>
  function useUserContextStore<OtherSlice>(ownerId: string): UserContextReader<OtherSlice>
  function useUserContextStore(ownerId?: string): UserContextReader<V> {
    return useBoundUserContext(ownerId)
  }

  function useBoundUserContext(ownerId?: string): UserContextReader<V> {
    const mount = useMfeMount('useUserContextStore()')
    if (
      mount.definitionId !== definitionId ||
      !mount.userContext ||
      (ownerId !== undefined && !mount.resolveUserContext)
    )
      throw new UserContextError(
        'unsupported-contract',
        definitionId,
        'Use the generated binding for this mounted definition',
      )
    return (
      ownerId === undefined ? mount.userContext : mount.resolveUserContext?.(ownerId)
    ) as UserContextReader<V>
  }

  function useUserContext(): UserContextStore<V>
  function useUserContext<OtherSlice>(ownerId: string): UserContextReader<OtherSlice>
  function useUserContext(ownerId?: string): UserContextReader<V> {
    const store = useBoundUserContext(ownerId)
    const subscribe = useCallback((listener: () => void) => store.observe(listener), [store])
    const getSnapshot = useCallback(() => store.getSnapshot(), [store])
    useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    return store
  }
  return { useUserContext, useUserContextStore }
}
