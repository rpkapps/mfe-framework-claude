/**
 * Mount lifecycle states and the state machine that owns their transitions
 * (§7.1, §7.2, §7.4).
 *
 * One object owns the whole lifecycle so that a maintainer can read every legal
 * transition in one place, rather than reconstructing it from effects scattered
 * across the adapters (§17.6).
 */

import { createMfeError, type MfeError } from './errors.ts'
import { SnapshotSource, type Subscribable, type Unsubscribe } from './observable.ts'

export type MountState =
  | { readonly status: 'pending'; readonly attempt: number }
  | { readonly status: 'mounted' }
  | { readonly status: 'error'; readonly error: MfeError }
  | { readonly status: 'disposed' }

export type MountStatus = MountState['status']

/** `mounted` and `disposed` carry no data, so one frozen value each is enough
 * to keep snapshot identity stable across repeated transitions (§1.4). */
const MOUNTED_STATE: MountState = Object.freeze({ status: 'mounted' as const })
const DISPOSED_STATE: MountState = Object.freeze({ status: 'disposed' as const })

/**
 * A token for one mount attempt. Every asynchronous step carries its token and
 * checks `isCurrent` before touching shared state, so a timed-out import or a
 * superseded retry can never attach UI or overwrite a newer attempt (§7.4).
 */
export interface AttemptToken {
  readonly attempt: number
  /** True while this attempt is still the lifecycle's active one. */
  isCurrent(): boolean
  /** Aborts when this attempt is superseded, or when the mount is disposed. */
  readonly signal: AbortSignal
}

export interface MountLifecycleOptions {
  readonly id: string
  readonly definitionVersion?: string
  readonly onListenerError?: (error: unknown) => void
}

/**
 * Owns the transitions between pending, mounted, error and disposed, together
 * with attempt generations and the mount-scoped abort signal.
 *
 * It deliberately knows nothing about React, routers or loading: the host's
 * mount controller drives it, and adapters observe it.
 */
export class MountLifecycle implements Subscribable<MountState> {
  readonly id: string
  readonly definitionVersion: string | undefined

  readonly #state: SnapshotSource<MountState>
  /** Aborts once, on disposal. Exposed to authors as `useMfeSignal` (§5.14). */
  readonly #disposeController = new AbortController()

  #attempt = 0
  #attemptController: AbortController | null = null
  #disposed = false
  #disposalPromise: Promise<void> | null = null

  constructor(options: MountLifecycleOptions) {
    this.id = options.id
    this.definitionVersion = options.definitionVersion
    this.#state = new SnapshotSource<MountState>(
      { status: 'pending', attempt: 0 },
      options.onListenerError === undefined
        ? {}
        : { onListenerError: options.onListenerError },
    )
  }

  /** Stable reference; safe for `useSyncExternalStore`. */
  readonly getSnapshot = (): MountState => this.#state.getSnapshot()

  /** Alias matching the public handle vocabulary in §7.1. */
  readonly getState = (): MountState => this.#state.getSnapshot()

  get state(): MountState {
    return this.#state.getSnapshot()
  }

  /** Stable reference; safe for `useSyncExternalStore`. */
  readonly subscribe = (listener: () => void): Unsubscribe => this.#state.subscribe(listener)

  get isDisposed(): boolean {
    return this.#disposed
  }

  /** Mount-scoped signal: aborts on disposal only (§5.14). */
  get signal(): AbortSignal {
    return this.#disposeController.signal
  }

  get currentAttempt(): number {
    return this.#attempt
  }

  /**
   * Starts a new attempt, superseding any attempt still running.
   *
   * The previous attempt's controller is aborted first so its in-flight work
   * settles as cancelled rather than racing the new one.
   */
  beginAttempt(): AttemptToken {
    this.#assertNotDisposed('begin a mount attempt')

    this.#attemptController?.abort(
      createMfeError({
        code: 'mount/failure',
        id: this.id,
        ...(this.definitionVersion === undefined
          ? {}
          : { definitionVersion: this.definitionVersion }),
        operation: 'supersede mount attempt',
        observed: 'a newer attempt started',
        repair: 'No action required; the superseded attempt was cancelled deliberately.',
      }),
    )

    this.#attempt += 1
    const attempt = this.#attempt
    const controller = new AbortController()
    this.#attemptController = controller

    this.#state.set({ status: 'pending', attempt })

    return {
      attempt,
      isCurrent: () => !this.#disposed && this.#attempt === attempt,
      signal: controller.signal,
    }
  }

  /** Marks the attempt mounted. Ignored if the attempt was superseded. */
  settleMounted(token: AttemptToken): boolean {
    if (!token.isCurrent()) return false
    return this.#state.set(MOUNTED_STATE)
  }

  /** Marks the attempt failed. Ignored if the attempt was superseded. */
  settleError(token: AttemptToken, error: MfeError): boolean {
    if (!token.isCurrent()) return false
    this.#attemptController?.abort(error)
    return this.#state.set({ status: 'error', error })
  }

  /**
   * Transitions to `disposed` and aborts both the attempt and mount signals.
   *
   * Idempotent: repeated calls observe the same terminal state. The caller owns
   * the asynchronous cleanup that follows; this only fences late work.
   */
  markDisposed(reason: MfeError): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#attemptController?.abort(reason)
    this.#attemptController = null
    this.#state.set(DISPOSED_STATE)
    this.#disposeController.abort(reason)
  }

  /**
   * Memoizes the disposal promise so `dispose()` is idempotent in the sense
   * §7.1 requires: every caller awaits the same cleanup, and a second call
   * never starts a second teardown.
   */
  runDisposalOnce(cleanup: () => Promise<void>): Promise<void> {
    this.#disposalPromise ??= cleanup()
    return this.#disposalPromise
  }

  dispose(): void {
    this.#state.dispose()
  }

  #assertNotDisposed(operation: string): void {
    if (!this.#disposed) return
    throw createMfeError({
      code: 'mount/failure',
      id: this.id,
      ...(this.definitionVersion === undefined
        ? {}
        : { definitionVersion: this.definitionVersion }),
      operation,
      expected: 'a live mount',
      observed: 'a disposed mount',
      declaredBy: 'The framework mount lifecycle',
      repair:
        'Create a new mount instead of reusing a disposed handle. Disposal is terminal: retry() cannot resurrect disposed work.',
    })
  }
}

/** The public lifecycle surface a host component or non-React host observes (§7.1). */
export interface MountHandle {
  readonly id: string
  readonly state: MountState
  getState(): MountState
  subscribe(listener: () => void): Unsubscribe
  /** Starts a fresh attempt using the latest committed inputs (§7.2). */
  retry(): void
  /** Idempotent; resolves when cleanup finishes, rejects with `dispose/timeout`. */
  dispose(): Promise<void>
}
