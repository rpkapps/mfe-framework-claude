import { assertInInjectionContext, computed, type Signal } from '@angular/core'
import {
  createUserContextSelection,
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

export type ReadonlyUserContextSelection<T> = {
  readonly value: Signal<T>
}

export type OwnedUserContextSelection<T, V> = ReadonlyUserContextSelection<T> & {
  readonly set: UserContextStore<V>['set']
}

/** Select nested values for the lifetime of the component, service, guard or resolver injector. */
export function createUserContextBindings<
  V,
  Reads extends Record<string, unknown> = Record<never, never>,
>(definitionId: string) {
  function injectUserContext<T>(
    selector: (context: Readonly<V>) => T,
  ): OwnedUserContextSelection<T, V>
  function injectUserContext<O extends keyof Reads & string, T>(
    ownerId: O,
    selector: (context: Readonly<Reads[O]>) => T,
  ): ReadonlyUserContextSelection<T>
  function injectUserContext(
    ownerOrSelector: unknown,
    foreignSelector?: unknown,
  ): ReadonlyUserContextSelection<unknown> {
    assertInInjectionContext(injectUserContext)
    const ownerId = typeof ownerOrSelector === 'string' ? ownerOrSelector : undefined
    const selector = ownerId === undefined ? ownerOrSelector : foreignSelector
    const mount = injectMfeMount('injectUserContext()')
    if (
      mount.definitionId !== definitionId ||
      !mount.userContext ||
      typeof selector !== 'function' ||
      (ownerId !== undefined && !mount.resolveUserContext)
    )
      throw new UserContextError(
        'unsupported-contract',
        definitionId,
        'Use the generated binding and a selector for this mounted definition',
      )
    const store = (
      ownerId === undefined ? mount.userContext : mount.resolveUserContext?.(ownerId)
    ) as UserContextReader<V>
    const selection = createUserContextSelection(
      store,
      selector as (context: Readonly<V>) => unknown,
    )
    // Capture scope failures so the next signal read reaches Angular error handling.
    const snapshot = signalFromStore(
      listener => selection.subscribe(listener),
      () => {
        try {
          return { ok: true as const, value: selection.getSnapshot() }
        } catch (error) {
          return { ok: false as const, error }
        }
      },
    )
    const selected = computed(() => {
      const current = snapshot()
      if (!current.ok) throw current.error
      return current.value
    })
    // Preserve the signal identity/marker while validating every read. A destroyed injector
    // stops observing, so a cached signal alone could retain data from an invalidated scope.
    const value = new Proxy(selected, {
      apply(target) {
        store.getSnapshot()
        return target()
      },
    })
    if (ownerId !== undefined) return Object.freeze({ value })
    const set: UserContextStore<V>['set'] = (key, update) =>
      (store as UserContextStore<V>).set(key, update)
    return Object.freeze({ value, set })
  }
  return { injectUserContext }
}
