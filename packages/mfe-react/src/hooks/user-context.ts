import { useMemo, useSyncExternalStore } from 'react'
import {
  createUserContextSelector,
  UserContextError,
  type UserContextReader,
  type UserContextStore,
  type UserContextService,
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
/** One hydration per runtime and signed-in user, shared by every component that reads it. */
const hostPreparations = new WeakMap<UserContextService, HostPreparation>()

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
    const runtime = useMfeRuntime('useUserContext()')
    const service = runtime.userContext
    const host = service?.host
    const ownerId = typeof selectorOrOwner === 'string' ? selectorOrOwner : undefined
    const selector = ownerId === undefined ? selectorOrOwner : foreignSelector
    if (mount || !service || !host || typeof selector !== 'function')
      throw new UserContextError(
        'undeclared',
        host?.id ?? '<shell>',
        'Use the generated shell binding inside its MfeProvider, outside an App or Widget mount, with userContext declared on createMfeRuntime',
      )
    const inspection = service.inspection
    const observer = useMemo(
      () => ({
        subscribe: (listener: () => void) => inspection.subscribe(listener),
        getSnapshot: () => inspection.getSnapshot().generation,
      }),
      [inspection],
    )
    const generation = useSyncExternalStore(
      observer.subscribe,
      observer.getSnapshot,
      observer.getSnapshot,
    )
    let preparation = hostPreparations.get(service)
    if (!preparation || preparation.generation !== generation) {
      const current: HostPreparation = {
        generation,
        status: 'pending',
        readers: new Map(),
        promise: service.prepare(host).then(
          () => {
            current.status = 'ready'
          },
          (error: unknown) => {
            current.status = 'failed'
            current.error = error
          },
        ),
      }
      hostPreparations.set(service, current)
      preparation = current
    }
    // React Suspense consumes the shared hydration promise and retries after it settles.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (preparation.status === 'pending') throw preparation.promise
    if (preparation.status === 'failed') throw preparation.error
    let store: UserContextReader
    if (ownerId === undefined) {
      preparation.store ??= service.bind(host)
      store = preparation.store
    } else {
      let reader = preparation.readers.get(ownerId)
      if (!reader) {
        reader = service.bindReadOnly(host, ownerId)
        preparation.readers.set(ownerId, reader)
      }
      store = reader
    }
    return useSelectedUserContext(store as UserContextReader<V>, selector, ownerId === undefined)
  }
  return { useUserContext }
}
