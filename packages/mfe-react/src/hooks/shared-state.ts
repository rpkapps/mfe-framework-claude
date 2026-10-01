import { useCallback, useSyncExternalStore } from 'react'
import {
  SharedStateError,
  type SharedStateSetter,
  type SharedStateUpdate,
  type SharedStateStore,
  type StateKey,
} from '@company/mfe-core/shared-state'
import { useMfeMount } from '../mount-context.tsx'

export type { SharedStateStore, SharedStateSetter } from '@company/mfe-core/shared-state'

/** Generated once per definition; only closures over immutable metadata, never a store singleton. */
export function createSharedStateBindings<V>(definitionId: string) {
  function useSharedStateStore(): SharedStateStore<V> {
    const mount = useMfeMount('useSharedStateStore()')
    if (mount.definitionId !== definitionId || !mount.sharedState)
      throw new SharedStateError(
        'unsupported-contract',
        definitionId,
        'Use the generated binding for this mounted definition',
      )
    return mount.sharedState as SharedStateStore<V>
  }
  function useSharedState<K extends StateKey<V>>(key: K): readonly [V[K], SharedStateSetter<V[K]>] {
    const store = useSharedStateStore()
    const subscribe = useCallback(
      (listener: () => void) => store.subscribe(key, listener),
      [store, key],
    )
    const getSnapshot = useCallback(() => store.get(key), [store, key])
    const set = useCallback((value: SharedStateUpdate<V[K]>) => store.set(key, value), [store, key])
    return [useSyncExternalStore(subscribe, getSnapshot), set]
  }
  return { useSharedState, useSharedStateStore }
}
