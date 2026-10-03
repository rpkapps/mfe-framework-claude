import { useMemo, useSyncExternalStore } from 'react'
import {
  createUserContextSelector,
  UserContextError,
  type UserContextReader,
  type UserContextStore,
  type UserContextRequirements,
  type UserContextService,
} from '@company/mfe-core/user-context'
import { useMfeMount, useOptionalMfeMount } from '../mount-context.tsx'
import { useMfeRuntime } from '../runtime-context.tsx'

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
    return useSelectedUserContext(store, selector, ownerId === undefined)
  }
  return { useUserContext }
}

function useSelectedUserContext<V>(
  store: UserContextReader<V>,
  selector: unknown,
  writable: boolean,
): readonly [unknown] | readonly [unknown, UserContextStore<V>['set']] {
  // Inline selectors are new closures each render; selections from one store's selector share
  // structure with the previous one, so an unchanged derived value keeps its identity.
  const select = useMemo(() => createUserContextSelector(store), [store])
  const selection = useMemo(
    () => select(selector as (context: Readonly<V>) => unknown),
    [select, selector],
  )
  const value = useSyncExternalStore(
    selection.subscribe,
    selection.getSnapshot,
    selection.getSnapshot,
  )
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

type HostPreparation = {
  readonly generation: number
  readonly promise: Promise<void>
  status: 'pending' | 'ready' | 'failed'
  error?: unknown
  readonly readers: Map<string, UserContextReader>
  store?: UserContextStore
}
const hostPreparations = new WeakMap<
  UserContextService,
  Map<UserContextRequirements, HostPreparation>
>()

/** @internal Generated shell binding; application components still call only useUserContext. */
export function createHostUserContextBindings<
  V,
  Reads extends Record<string, unknown> = Record<never, never>,
>(requirements: UserContextRequirements) {
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
    const runtime = useMfeRuntime('useUserContext()')
    const service = runtime.userContext
    const ownerId = typeof selectorOrOwner === 'string' ? selectorOrOwner : undefined
    const selector = ownerId === undefined ? selectorOrOwner : foreignSelector
    if (mount || !service || typeof selector !== 'function')
      throw new UserContextError(
        'unsupported-contract',
        requirements.ownerId,
        'Use the generated shell binding inside its MfeProvider, outside an App or Widget mount',
      )
    const inspection = service.inspection
    const observer = useMemo(
      () => ({
        subscribe: (listener: () => void) => inspection?.subscribe(listener) ?? (() => {}),
        getSnapshot: () => inspection?.getSnapshot().generation ?? 0,
      }),
      [inspection],
    )
    const generation = useSyncExternalStore(
      observer.subscribe,
      observer.getSnapshot,
      observer.getSnapshot,
    )
    let preparations = hostPreparations.get(service)
    if (!preparations) {
      preparations = new Map()
      hostPreparations.set(service, preparations)
    }
    let preparation = preparations.get(requirements)
    if (!preparation || preparation.generation !== generation) {
      const current: HostPreparation = {
        generation,
        status: 'pending',
        readers: new Map(),
        promise: service.prepare(requirements).then(
          () => {
            current.status = 'ready'
          },
          (error: unknown) => {
            current.status = 'failed'
            current.error = error
          },
        ),
      }
      preparations.set(requirements, current)
      preparation = current
    }
    // React Suspense consumes the shared hydration promise and retries after it settles.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (preparation.status === 'pending') throw preparation.promise
    if (preparation.status === 'failed') throw preparation.error
    let store: UserContextReader
    if (ownerId === undefined) {
      preparation.store ??= service.bind(requirements.ownerId, requirements)
      store = preparation.store
    } else {
      let reader = preparation.readers.get(ownerId)
      if (!reader) {
        reader = service.bindReadOnly(requirements.ownerId, requirements, ownerId)
        preparation.readers.set(ownerId, reader)
      }
      store = reader
    }
    return useSelectedUserContext(store as UserContextReader<V>, selector, ownerId === undefined)
  }
  return { useUserContext }
}
