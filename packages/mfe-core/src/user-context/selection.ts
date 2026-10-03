import type { UserContextReader } from './index.ts'

const unsupported = (): never => {
  throw new TypeError(
    'User-context selectors must return primitives, plain objects or arrays; functions, class instances and cyclic results are not supported',
  )
}
const plain = (value: object): boolean =>
  Array.isArray(value) ||
  Object.getPrototypeOf(value) === Object.prototype ||
  Object.getPrototypeOf(value) === null

/**
 * Freeze a selector result, keeping every branch equal to the previous result as it was, so an
 * unchanged selection keeps its identity and nothing rerenders.
 */
function share(previous: unknown, next: unknown, visiting = new Set<object>()): unknown {
  if (typeof next === 'function' || typeof next === 'symbol' || typeof next === 'bigint')
    return unsupported()
  if (Object.is(previous, next) || next === null || typeof next !== 'object') return next
  if (!plain(next) || visiting.has(next)) return unsupported()
  visiting.add(next)
  const array = Array.isArray(next)
  const before =
    previous !== null && typeof previous === 'object' && Array.isArray(previous) === array
      ? (previous as Record<string, unknown>)
      : undefined
  const keys = array ? [...(next as unknown[]).keys()].map(String) : Object.keys(next)
  let equal = before !== undefined && Object.keys(before).length === keys.length
  let unchanged = true
  const result = (array ? [] : {}) as Record<string, unknown>
  for (const key of keys) {
    const source = (next as Record<string, unknown>)[key]
    const value = share(before?.[key], source, visiting)
    if (!before || !Object.hasOwn(before, key) || !Object.is(value, before[key])) equal = false
    if (!Object.is(value, source)) unchanged = false
    result[key] = value
  }
  visiting.delete(next)
  if (equal) return before
  // A branch of the frozen runtime snapshot can be returned as it is.
  return unchanged && Object.isFrozen(next) ? next : Object.freeze(result)
}

export interface UserContextSelection<V> {
  /**
   * Run the selector against the current snapshot. It reruns only when the record or the selector
   * changed, and a result equal to the previous one keeps its identity, so a selector closure
   * recreated on every render is cheap. Every call still validates the live scope.
   */
  readonly read: <T>(selector: (value: Readonly<V>) => T) => T
  /** Observe the owner record; also calls back when it changed since the last read. */
  readonly subscribe: (listener: () => void) => () => void
}

/**
 * Selects from one owner's record. Selectors synchronously read immutable JSON data and return
 * primitives, plain objects or arrays; returned data is deeply immutable. Framework bindings decide
 * when to subscribe and own the returned cleanup.
 */
export function createUserContextSelection<V>(
  store: UserContextReader<V>,
): UserContextSelection<V> {
  let source: Readonly<V> | undefined
  let selected: unknown
  let value: unknown
  let failure: { readonly error: unknown } | undefined
  return {
    read: <T>(selector: (value: Readonly<V>) => T): T => {
      const next = store.getSnapshot()
      if (next !== source || selector !== selected) {
        try {
          value = share(value, selector(next))
          failure = undefined
        } catch (error) {
          failure = { error }
        }
        source = next
        selected = selector
      }
      if (failure) throw failure.error
      return value as T
    },
    subscribe: listener => {
      const read = source
      const stop = store.observe(listener)
      let changed: boolean
      try {
        changed = store.getSnapshot() !== read
      } catch {
        // A reset or an invalid record: the listener reads again and meets the error.
        changed = true
      }
      // A commit between the render that read and this subscription must not be missed.
      if (read !== undefined && changed) listener()
      return stop
    },
  }
}
