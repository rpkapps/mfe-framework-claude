/**
 * The container-loading port: an internal seam, not a public loader API. The host
 * orchestrates loading but never performs it, which is what keeps federation in the React
 * adapter rather than this package (§6).
 */

import {
  toMfeError,
  type DefinitionIdentity,
  type MfeError,
  type RegistryEntry,
} from '@company/mfe-core'

export interface LoadedDefinition<TModule = unknown> {
  readonly identity: DefinitionIdentity
  readonly module: TModule
}

export interface ContainerLoader<TModule = unknown> {
  load(
    entry: RegistryEntry,
    options: { readonly signal: AbortSignal },
  ): Promise<LoadedDefinition<TModule>>
  /** Speculative warm-up that must never create a mount, or anything a mount would clean up. */
  preload?(entry: RegistryEntry, options: { readonly signal: AbortSignal }): Promise<void>
}

/** The shared promise is tied to no caller's signal, so abandoning a load cannot cancel it. */
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
    entry: RegistryEntry,
    options: { readonly signal: AbortSignal },
  ): Promise<LoadedDefinition<TModule>> {
    const cached = this.#resolved.get(entry.id)
    if (cached) return cached

    let shared = this.#inFlight.get(entry.id)
    if (!shared) {
      // Deliberately not `options.signal`: the shared work outlives any one waiter, which
      // rejects below without cancelling it.
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

  preload(entry: RegistryEntry, options: { readonly signal: AbortSignal }): Promise<void> {
    if (this.#inner.preload) return this.#inner.preload(entry, options)
    // Failures are swallowed because an abandoned or failed preload must not break the
    // currently mounted App; a later real navigation takes the error and retry path.
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

/** The shared work is always observed, so an eventual rejection is never an unhandled one. */
function raceWithAbort<T>(
  shared: Promise<T>,
  signal: AbortSignal,
  entry: RegistryEntry,
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
    // The shared work keeps running for the other waiters, so it still has to be observed.
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

  // Racing rather than re-wrapping keeps a rejection reaching this caller exactly as thrown.
  return Promise.race([shared, cancelled]).finally(() => {
    if (abandon !== undefined) signal.removeEventListener('abort', abandon)
  })
}
