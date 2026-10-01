import { assertInInjectionContext, type Signal } from '@angular/core'
import {
  SharedStateError,
  type SharedStateSetter,
  type SharedStateStore,
  type StateKey,
} from '@company/mfe-core/shared-state'
import { signalFromStore } from '../signals.ts'
import { injectMfeMount } from './runtime.ts'

export type { SharedStateStore, SharedStateSetter } from '@company/mfe-core/shared-state'

/** Per-injector bindings work in components, services, route guards and resolvers. */
export function createSharedStateBindings<V>(definitionId: string) {
  function injectSharedStateStore(): SharedStateStore<V> {
    assertInInjectionContext(injectSharedStateStore)
    const mount = injectMfeMount('injectSharedStateStore()')
    if (mount.definitionId !== definitionId || !mount.sharedState)
      throw new SharedStateError(
        'unsupported-contract',
        definitionId,
        'Use the generated binding for this mounted definition',
      )
    return mount.sharedState as SharedStateStore<V>
  }
  function injectSharedState<K extends StateKey<V>>(
    key: K,
  ): readonly [Signal<V[K]>, SharedStateSetter<V[K]>] {
    assertInInjectionContext(injectSharedState)
    const store = injectSharedStateStore()
    return [
      signalFromStore(
        listener => store.subscribe(key, listener),
        () => store.get(key),
      ),
      value => store.set(key, value),
    ]
  }
  return { injectSharedState, injectSharedStateStore }
}
