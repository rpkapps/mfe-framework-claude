/**
 * The container-loading port: an internal seam, not a public loader API. The host
 * orchestrates loading through it, and a shell chooses what performs it — the federation
 * loader beside this file, handed its runtime, or an in-process loader in a test.
 */

import {
  toMfeError,
  type DefinitionIdentity,
  type MfeError,
  type RegistryEntry,
} from '@company/mfe-core'

import { DEFAULT_DEADLINES, withDeadline } from '../deadline.ts'

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

export interface SharedContainerLoaderOptions {
  /** The underlying attempt's own deadline, independent of any one mount's wait. */
  readonly deadlineMs?: number
}

/** A caller can abandon its wait; the shared attempt has a separate, finite lifetime. */
export class SharedContainerLoader<TModule = unknown> implements ContainerLoader<TModule> {
  readonly #inner: ContainerLoader<TModule>
  readonly #deadlineMs: number
  readonly #inFlight = new Map<string, Promise<LoadedDefinition<TModule>>>()
  readonly #resolved = new Map<string, LoadedDefinition<TModule>>()

  constructor(inner: ContainerLoader<TModule>, options: SharedContainerLoaderOptions = {}) {
    this.#inner = inner
    this.#deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINES.load
    if (!Number.isFinite(this.#deadlineMs) || this.#deadlineMs <= 0) {
      throw new RangeError('A shared container load requires a finite, positive deadlineMs.')
    }
  }

  /** How many loads are currently shared; used by the resource-retention tests. */
  get inFlightCount(): number {
    return this.#inFlight.size
  }

  async load(
    entry: RegistryEntry,
    options: { readonly signal: AbortSignal },
  ): Promise<LoadedDefinition<TModule>> {
    // Disposed hosts must not start work, including when no other caller has loaded this entry.
    if (options.signal.aborted) throw abandonmentError(options.signal, entry)
    const cached = this.#resolved.get(entry.id)
    if (cached) return cached

    let shared = this.#inFlight.get(entry.id)
    if (!shared) {
      // The deadline owns cancellation; disposing any one waiter cannot abort its siblings.
      const attempt = withDeadline(
        signal => this.#inner.load(entry, { signal }),
        this.#deadlineMs,
        {
          id: entry.id,
          operation: 'load shared container',
          phase: 'load',
          ...(entry.version === undefined ? {} : { definitionVersion: entry.version }),
        },
      )
        .then(loaded => {
          // Only a current attempt may publish. An expired underlying load may settle later.
          if (this.#inFlight.get(entry.id) === attempt) this.#resolved.set(entry.id, loaded)
          return loaded
        })
        .finally(() => {
          if (this.#inFlight.get(entry.id) === attempt) this.#inFlight.delete(entry.id)
        })
      shared = attempt
      this.#inFlight.set(entry.id, shared)
    }

    return await raceWithAbort(shared, options.signal, entry)
  }

  preload(entry: RegistryEntry, options: { readonly signal: AbortSignal }): Promise<void> {
    if (options.signal.aborted) return Promise.resolve()
    const preload = this.#inner.preload?.bind(this.#inner)
    if (preload) {
      return withDeadline(
        signal => preload(entry, { signal }),
        this.#deadlineMs,
        { id: entry.id, operation: 'preload container', phase: 'load' },
        options,
      ).catch(() => undefined)
    }
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

function abandonmentError(signal: AbortSignal, entry: RegistryEntry): MfeError {
  return toMfeError(signal.reason, {
    code: 'load/entry-failure',
    id: entry.id,
    operation: 'load container',
    observed: 'the caller stopped waiting before the container finished loading',
    repair:
      'No action required when this follows a disposal or a retry. Other callers waiting on the same container are unaffected.',
  })
}

/** The shared work is always observed, so an eventual rejection is never an unhandled one. */
export function raceWithAbort<T>(
  shared: Promise<T>,
  signal: AbortSignal,
  entry: RegistryEntry,
): Promise<T> {
  if (!signal.aborted && typeof signal.addEventListener !== 'function') return shared

  const abandonment = (): MfeError => abandonmentError(signal, entry)

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
