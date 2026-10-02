import { assertInInjectionContext } from '@angular/core'
import {
  UserContextError,
  type UserContextReader,
  type UserContextStore,
} from '@company/mfe-core/user-context'
import { signalFromStore } from '../signals.ts'
import { injectMfeMount } from './runtime.ts'

export type {
  UserContextReader,
  UserContextStore,
  UserContextSetter,
} from '@company/mfe-core/user-context'

/** Bindings work in components, services, route guards and resolvers in the mounted injector. */
export function createUserContextBindings<V>(definitionId: string) {
  function injectUserContextStore(): UserContextStore<V>
  function injectUserContextStore<OtherSlice>(ownerId: string): UserContextReader<OtherSlice>
  function injectUserContextStore(ownerId?: string): UserContextReader<V> {
    assertInInjectionContext(injectUserContextStore)
    const mount = injectMfeMount('injectUserContextStore()')
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

  function injectUserContext(): UserContextStore<V>
  function injectUserContext<OtherSlice>(ownerId: string): UserContextReader<OtherSlice>
  function injectUserContext(ownerId?: string): UserContextReader<V> {
    assertInInjectionContext(injectUserContext)
    const store =
      ownerId === undefined ? injectUserContextStore() : injectUserContextStore<V>(ownerId)
    // Scope invalidation makes the runtime snapshot throw. Capture that failure in the signal
    // so the next template read reaches Angular's error handling instead of retaining old data.
    const snapshot = signalFromStore(
      listener => store.observe(listener),
      () => {
        try {
          return { ok: true as const, value: store.getSnapshot() }
        } catch (error) {
          return { ok: false as const, error }
        }
      },
    )
    return Object.freeze({
      ...store,
      get: <K extends keyof V & string>(key: K): V[K] => {
        const current = snapshot()
        if (!current.ok) throw current.error
        // A destroyed injector has unsubscribed, so its cached signal cannot observe a later
        // scope switch or mount abort. Validate every read against the live binding as well.
        store.get(key)
        return current.value[key]
      },
    })
  }
  return { injectUserContext, injectUserContextStore }
}
