/** Mount lifecycle states, with one object owning every legal transition between them. */

import {
  createMfeError,
  withoutUndefined,
  type AttemptToken,
  type MfeError,
  type MfeErrorDetails,
  type MountState,
  type Subscribable,
  type Unsubscribe,
} from '@company/mfe-core'

import { SnapshotSource } from '../observable.ts'

/** One frozen value each, so snapshot identity is stable across repeated transitions. */
const MOUNTED_STATE: MountState = Object.freeze({ status: 'mounted' as const })
const DISPOSED_STATE: MountState = Object.freeze({ status: 'disposed' as const })

export interface MountLifecycleOptions {
  readonly id: string
  readonly definitionVersion?: string
  readonly onListenerError?: (error: unknown) => void
}

/** Knows nothing about React, routers or loading: the host's mount controller drives it. */
export class MountLifecycle implements Subscribable<MountState> {
  readonly id: string
  readonly definitionVersion: string | undefined

  readonly #state: SnapshotSource<MountState>
  /** Aborts once, on disposal, where an attempt's own controller aborts on every retry too. */
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
      options.onListenerError === undefined ? {} : { onListenerError: options.onListenerError },
    )
  }

  /** Stable reference; safe for `useSyncExternalStore`. */
  readonly getSnapshot = (): MountState => this.#state.getSnapshot()

  /** Alias matching the public mount-handle vocabulary. */
  readonly getState = (): MountState => this.#state.getSnapshot()

  readonly subscribe = (listener: () => void): Unsubscribe => this.#state.subscribe(listener)

  get isDisposed(): boolean {
    return this.#disposed
  }

  /** Mount-scoped signal: aborts on disposal only. */
  get signal(): AbortSignal {
    return this.#disposeController.signal
  }

  /** The previous controller aborts first, so its in-flight work cannot race the new attempt. */
  beginAttempt(): AttemptToken {
    if (this.#disposed) {
      throw this.#fail({
        operation: 'begin a mount attempt',
        expected: 'a live mount',
        observed: 'a disposed mount',
        repair: 'Create a new mount; disposal is terminal and retry() cannot undo it.',
      })
    }

    this.#attemptController?.abort(
      this.#fail({
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

  /** Ignored if the attempt was superseded. */
  settleMounted(token: AttemptToken): boolean {
    if (!token.isCurrent()) return false
    return this.#state.set(MOUNTED_STATE)
  }

  /** Ignored if the attempt was superseded. */
  settleError(token: AttemptToken, error: MfeError): boolean {
    if (!token.isCurrent()) return false
    this.#attemptController?.abort(error)
    return this.#state.set({ status: 'error', error })
  }

  /** Idempotent; the caller owns the asynchronous cleanup that follows, this only fences late work. */
  markDisposed(reason: MfeError): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#attemptController?.abort(reason)
    this.#attemptController = null
    this.#state.set(DISPOSED_STATE)
    this.#disposeController.abort(reason)
  }

  /** Every caller awaits the same cleanup, so a second call never starts a second teardown. */
  runDisposalOnce(cleanup: () => Promise<void>): Promise<void> {
    this.#disposalPromise ??= cleanup()
    return this.#disposalPromise
  }

  dispose(): void {
    this.#state.dispose()
  }

  #fail(details: Omit<MfeErrorDetails, 'code' | 'id'> & Partial<MfeErrorDetails>): MfeError {
    return createMfeError({
      code: 'mount/failure',
      id: this.id,
      ...withoutUndefined({ definitionVersion: this.definitionVersion }),
      ...details,
    })
  }
}
