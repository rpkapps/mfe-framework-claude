/**
 * The container-loading port: an internal seam, not a public loader API.
 *
 * The host orchestrates loading but never performs it — the Module Federation
 * implementation lives in the React adapter and tests supply an in-process
 * loader. That inversion keeps federation out of this package entirely and lets
 * the contract tests run with no bundler, manifest or network.
 */

import {
  toMfeError,
  type DefinitionIdentity,
  type MfeError,
  type NeutralRegistryEntry,
} from '@company/mfe-core'

/** The identity the container advertises, plus the module its adapter mounts. */
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
 * The shared promise is tied to no single caller's signal, so one caller
 * abandoning a load cannot cancel work another still needs.
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

  /** Disposal does not call this: a module cache is not mount state. */
  clearCache(): void {
    this.#resolved.clear()
  }
}

function neverAborted(): AbortSignal {
  return new AbortController().signal
}

/**
 * Lets one waiter give up without disturbing the shared work, which is always
 * observed so an eventual rejection cannot surface as an unhandled one.
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
