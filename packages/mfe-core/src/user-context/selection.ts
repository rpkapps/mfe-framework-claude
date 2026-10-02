import type { UserContextReader } from './index.ts'

type Key = string | symbol
type Path = readonly Key[]
interface Read {
  readonly source: unknown
  readonly path: Path
  readonly children: Map<Key, Read>
  readonly has: Map<Key, boolean>
  readonly own: Map<Key, boolean>
  keys: readonly Key[] | undefined
  whole: boolean
  proxy?: object
}

const object = (value: unknown): value is object => value !== null && typeof value === 'object'
const plain = (value: object): boolean =>
  Array.isArray(value) ||
  Object.getPrototypeOf(value) === Object.prototype ||
  Object.getPrototypeOf(value) === null
const read = (source: unknown, path: Path): Read => ({
  source,
  path,
  children: new Map(),
  has: new Map(),
  own: new Map(),
  keys: undefined,
  whole: false,
})
const sameKeys = (a: readonly Key[], b: readonly Key[]): boolean =>
  a.length === b.length && a.every((key, index) => key === b[index])

/** Preserve unchanged JSON branches even when persistence rematerializes the whole owner slice. */
function share(previous: unknown, next: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (Object.is(previous, next)) return previous
  if (!object(next) || !plain(next)) return next
  if (seen.has(next)) return seen.get(next)
  const comparable =
    object(previous) && Object.getPrototypeOf(previous) === Object.getPrototypeOf(next)
  const keys = Reflect.ownKeys(next)
  let equal = comparable && sameKeys(Reflect.ownKeys(previous), keys)
  const result: object = Array.isArray(next)
    ? []
    : (Object.create(Object.getPrototypeOf(next) as object | null) as object)
  seen.set(next, result)
  for (const key of keys) {
    if (Array.isArray(next) && key === 'length') continue
    const value = share(
      comparable ? Reflect.get(previous, key) : undefined,
      Reflect.get(next, key),
      seen,
    )
    if (!comparable || !Object.is(value, Reflect.get(previous, key))) equal = false
    Object.defineProperty(result, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  if (Array.isArray(next)) (result as unknown[]).length = next.length
  const shared = equal ? previous : Object.freeze(result)
  seen.set(next, shared)
  return shared
}

function matches(dependency: Read, next: unknown): boolean {
  if (Object.is(dependency.source, next)) return true
  if (
    !dependency.path.length &&
    !dependency.whole &&
    !dependency.children.size &&
    !dependency.has.size &&
    !dependency.own.size &&
    !dependency.keys
  )
    return true
  if (!object(dependency.source) || !object(next)) return false
  if (Object.getPrototypeOf(dependency.source) !== Object.getPrototypeOf(next)) return false
  if (
    dependency.whole ||
    (!dependency.children.size && !dependency.has.size && !dependency.own.size && !dependency.keys)
  )
    return Object.is(share(dependency.source, next), dependency.source)
  if (dependency.keys && !sameKeys(dependency.keys, Reflect.ownKeys(next))) return false
  for (const [key, present] of dependency.has) if (Reflect.has(next, key) !== present) return false
  for (const [key, present] of dependency.own)
    if (Object.hasOwn(next, key) !== present) return false
  for (const [key, child] of dependency.children)
    if (!matches(child, Reflect.get(next, key))) return false
  return true
}

function track(root: Read): { value: object; unwrap: (value: unknown) => unknown } {
  const proxies = new WeakMap<object, Read>()
  const wrap = (dependency: Read): object => {
    if (dependency.proxy) return dependency.proxy
    const source = dependency.source as object
    // A fresh target avoids Proxy invariants on the deeply frozen runtime snapshot.
    const target: object = Array.isArray(source)
      ? []
      : (Object.create(Object.getPrototypeOf(source) as object | null) as object)
    const mutation = (): never => {
      throw new TypeError('User-context selectors must not mutate their input')
    }
    const property = (key: Key): unknown => {
      let child = dependency.children.get(key)
      if (!child) {
        child = read(Reflect.get(source, key), [...dependency.path, key])
        dependency.children.set(key, child)
      }
      return object(child.source) ? wrap(child) : child.source
    }
    const proxy = new Proxy(target, {
      get: (_target, key) => property(key),
      has: (_target, key) => {
        const present = Reflect.has(source, key)
        dependency.has.set(key, present)
        return present
      },
      ownKeys: () => {
        dependency.keys = Reflect.ownKeys(source)
        return [...dependency.keys]
      },
      getOwnPropertyDescriptor: (_target, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(source, key)
        dependency.own.set(key, descriptor !== undefined)
        if (!descriptor) return undefined
        if (Array.isArray(source) && key === 'length')
          return { value: property(key), writable: true, enumerable: false, configurable: false }
        return { ...descriptor, value: property(key), configurable: true }
      },
      set: mutation,
      deleteProperty: mutation,
      defineProperty: mutation,
      setPrototypeOf: mutation,
      preventExtensions: mutation,
    })
    dependency.proxy = proxy
    proxies.set(proxy, dependency)
    return proxy
  }
  const seen = new WeakMap<object, unknown>()
  const visiting = new WeakSet<object>()
  const unsupported = (): never => {
    throw new TypeError(
      'User-context selectors must return primitives, plain objects or arrays; functions, class instances and cyclic results are not supported',
    )
  }
  const unwrap = (value: unknown): unknown => {
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint')
      return unsupported()
    if (!object(value)) return value
    const dependency = proxies.get(value)
    if (dependency) {
      dependency.whole = true
      return dependency.source
    }
    if (!plain(value) || visiting.has(value)) return unsupported()
    if (seen.has(value)) return seen.get(value)
    const result: object = Array.isArray(value)
      ? []
      : (Object.create(Object.getPrototypeOf(value) as object | null) as object)
    seen.set(value, result)
    visiting.add(value)
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue
      Object.defineProperty(result, key, {
        value: unwrap(Reflect.get(value, key)),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    if (Array.isArray(value)) (result as unknown[]).length = value.length
    visiting.delete(value)
    return Object.freeze(result)
  }
  return { value: wrap(root), unwrap }
}

/**
 * A lifecycle-neutral selector subscription. Selectors synchronously read immutable JSON data;
 * only accessed owner fields are subscribed, and nested siblings do not rerun the selector.
 * Results must be primitives, plain objects or arrays; returned data is deeply immutable.
 * Framework bindings own the returned cleanup. Every read still validates the live scope.
 */
export function createUserContextSelection<V, T>(
  store: UserContextReader<V>,
  selector: (value: Readonly<V>) => T,
): { readonly getSnapshot: () => T; readonly subscribe: (listener: () => void) => () => void } {
  let source: Readonly<V> | undefined
  let dependency: Read | undefined
  let value: T
  let failed = false
  let error: unknown
  let initialized = false
  const listeners = new Set<() => void>()
  const subscriptions = new Map<string | null, () => void>()

  const refresh = (): void => {
    // Never short-circuit scope validation, including after all subscribers have detached.
    const next = store.getSnapshot()
    if (initialized && Object.is(source, next)) return
    if (initialized && !failed && dependency && matches(dependency, next)) {
      source = next
      return
    }
    const nextDependency = read(next, [])
    const tracked = track(nextDependency)
    try {
      const selected = tracked.unwrap(selector(tracked.value as Readonly<V>))
      value = (initialized && !failed ? share(value, selected) : selected) as T
      failed = false
    } catch (caught) {
      error = caught
      failed = true
    }
    initialized = true
    source = next
    dependency = nextDependency
  }
  const desired = (): Set<string | null> => {
    // Root enumeration/selection and constant selectors need the lifecycle observer. Key
    // subscriptions already deliver owner-scope invalidation, so avoid a broad observer otherwise.
    if (!dependency || dependency.whole || dependency.keys) return new Set([null])
    const keys = [...dependency.children.keys(), ...dependency.has.keys(), ...dependency.own.keys()]
    // Optional fields and prototype methods may not be legal store.subscribe keys. Observing
    // the owner is safe here; dependency comparison still filters unrelated commits.
    if (
      !keys.length ||
      keys.some(key => typeof key !== 'string' || !Object.hasOwn(source as object, key))
    )
      return new Set([null])
    return new Set(keys as string[])
  }
  let reconciling = false
  let pending = false
  const changed = (): void => {
    if (reconciling) {
      pending = true
      return
    }
    const previous = value
    const previouslyFailed = failed
    let invalid = false
    try {
      refresh()
      reconcile()
    } catch {
      invalid = true
    }
    if (invalid || failed || previouslyFailed || !Object.is(previous, value))
      for (const listener of [...listeners]) listener()
  }
  const reconcile = (): void => {
    if (!listeners.size || reconciling) return
    reconciling = true
    try {
      const keys = desired()
      for (const [key, unsubscribe] of subscriptions) {
        if (!keys.has(key)) {
          unsubscribe()
          subscriptions.delete(key)
        }
      }
      for (const key of keys) {
        if (!subscriptions.has(key))
          subscriptions.set(
            key,
            key === null
              ? store.observe(changed)
              : store.subscribe(key as keyof V & string, changed),
          )
      }
    } finally {
      reconciling = false
    }
    if (pending) {
      pending = false
      changed()
    }
  }
  const getSnapshot = (): T => {
    refresh()
    reconcile()
    if (failed) throw error
    return value
  }
  return {
    getSnapshot,
    subscribe: listener => {
      const previous = getSnapshot()
      listeners.add(listener)
      try {
        reconcile()
        // A commit between the render/read and subscribing must not be missed.
        if (!Object.is(previous, getSnapshot())) listener()
      } catch (caught) {
        listeners.delete(listener)
        if (!listeners.size) {
          for (const unsubscribe of subscriptions.values()) unsubscribe()
          subscriptions.clear()
        }
        throw caught
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) {
          for (const unsubscribe of subscriptions.values()) unsubscribe()
          subscriptions.clear()
        }
      }
    },
  }
}
