/**
 * The container-loading port.
 *
 * The neutral host orchestrates loading but never performs it: the concrete
 * Module Federation implementation lives in the React adapter, and tests supply
 * an in-process loader instead. That inversion is what keeps Module Federation
 * out of this package entirely, and it is also what lets the contract tracer
 * bullet run with no bundler, no manifest and no network.
 *
 * The seam is internal. It is not a public loader API for authors.
 */

import {
  createMfeError,
  toMfeError,
  type DefinitionIdentity,
  type MfeError,
  type NeutralRegistryEntry,
} from '@company/mfe-core'

/**
 * What a loader returns: the definition's identity as the container advertises
 * it, plus the opaque module the owning adapter knows how to mount.
 */
export interface LoadedDefinition<TModule = unknown> {
  readonly identity: DefinitionIdentity
  readonly module: TModule
}

export interface ContainerLoader<TModule = unknown> {
  load(
    entry: NeutralRegistryEntry,
    options: { readonly signal: AbortSignal },
  ): Promise<LoadedDefinition<TModule>>
  /**
   * Optional speculative warm-up. It may resolve metadata, code, styles and
   * configuration, but must never create an active mount or produce resources
   * that need a mounted owner to clean up.
   */
  preload?(entry: NeutralRegistryEntry, options: { readonly signal: AbortSignal }): Promise<void>
}

/**
 * Deduplicates concurrent loads of the same container and caches the result.
 *
 * One caller abandoning a load must not cancel work another active caller still
 * needs, so the shared promise is not tied to any single caller's signal; each
 * waiter settles within its own deadline instead.
 */
export class SharedContainerLoader<TModule = unknown> implements ContainerLoader<TModule> {
  readonly #inner: ContainerLoader<TModule>
  readonly #inFlight = new Map<string, Promise<LoadedDefinition<TModule>>>()
  readonly #resolved = new Map<string, LoadedDefinition<TModule>>()

  constructor(inner: ContainerLoader<TModule>) {
    this.#inner = inner
  }

  /** How many loads are currently shared; used by the resource-retention tests. */
  get inFlightCount(): number {
    return this.#inFlight.size
  }

  async load(
    entry: NeutralRegistryEntry,
    options: { readonly signal: AbortSignal },
  ): Promise<LoadedDefinition<TModule>> {
    const cached = this.#resolved.get(entry.id)
    if (cached) return cached

    let shared = this.#inFlight.get(entry.id)
    if (!shared) {
      // Deliberately not `options.signal`: the shared work outlives any one
      // waiter. An abandoning caller rejects below without cancelling it.
      shared = this.#inner
        .load(entry, { signal: neverAborted() })
        .then(loaded => {
          this.#resolved.set(entry.id, loaded)
          return loaded
        })
        .finally(() => {
          this.#inFlight.delete(entry.id)
        })
      this.#inFlight.set(entry.id, shared)
    }

    return await raceWithAbort(shared, options.signal, entry)
  }

  preload(entry: NeutralRegistryEntry, options: { readonly signal: AbortSignal }): Promise<void> {
    if (this.#inner.preload) return this.#inner.preload(entry, options)
    // Warming the shared load is a valid preload: it resolves code without
    // creating a mount. Failures are swallowed because an abandoned or failed
    // preload must not break the currently mounted App; a later real
    // navigation takes the standard error and retry path.
    return this.load(entry, options).then(
      () => undefined,
      () => undefined,
    )
  }

  /** Drops cached modules. Disposal does not call this: module caching is a
   * cache, not mount state, and must survive a mount's teardown. */
  clearCache(): void {
    this.#resolved.clear()
  }
}

function neverAborted(): AbortSignal {
  return new AbortController().signal
}

/**
 * Lets one waiter give up without disturbing the shared work. The shared
 * promise is always observed so an eventual rejection cannot surface as an
 * unhandled rejection.
 */
function raceWithAbort<T>(
  shared: Promise<T>,
  signal: AbortSignal,
  entry: NeutralRegistryEntry,
): Promise<T> {
  if (!signal.aborted && typeof signal.addEventListener !== 'function') return shared

  const abandonment = (): MfeError =>
    toMfeError(signal.reason, {
      code: 'load/entry-failure',
      id: entry.id,
      operation: 'load container',
      observed: 'the caller stopped waiting before the container finished loading',
      declaredBy: 'The host mount controller',
      repair:
        'No action required when this follows a disposal or a retry. Other callers waiting on the same container are unaffected.',
    })

  if (signal.aborted) {
    // The shared work keeps running for the other waiters, so it still has to
    // be observed here or this caller's exit surfaces as an unhandled rejection.
    shared.catch(() => undefined)
    return Promise.reject(abandonment())
  }

  let abandon: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    abandon = (): void => {
      reject(abandonment())
    }
    signal.addEventListener('abort', abandon, { once: true })
  })

  // Racing the two rather than re-wrapping the shared promise is what keeps a
  // rejection of the shared work reaching this caller exactly as it was thrown.
  return Promise.race([shared, cancelled]).finally(() => {
    if (abandon !== undefined) signal.removeEventListener('abort', abandon)
  })
}

/**
 * An in-process loader used by the contract tests and the author testing
 * utilities. Definitions are registered directly, so no bundler, manifest or
 * network is involved.
 */
export function createInProcessLoader<TModule>(
  definitions: ReadonlyMap<string, LoadedDefinition<TModule>>,
): ContainerLoader<TModule> {
  return {
    // `async` is load-bearing here rather than incidental. The ContainerLoader
    // contract requires an already-aborted signal and a missing definition to
    // arrive as a rejected promise, and this implementation resolves from a Map
    // with nothing to await; without `async` both become a synchronous throw at
    // the call site, which no caller of a Promise-returning port handles.
    // eslint-disable-next-line @typescript-eslint/require-await -- the async signature is the port's contract and there is genuinely nothing to await
    load: async (entry, options) => {
      options.signal.throwIfAborted()

      const loaded = definitions.get(entry.id)
      if (!loaded) {
        throw createMfeError({
          code: 'load/entry-failure',
          id: entry.id,
          operation: 'resolve definition from the in-process loader',
          expected: `a definition registered under "${entry.id}"`,
          observed:
            definitions.size === 0
              ? 'an empty loader'
              : `only ${[...definitions.keys()].join(', ')}`,
          declaredBy: 'The in-process test loader',
          repair: 'Register the definition with the test environment before mounting it.',
        })
      }

      return loaded
    },
  }
}
