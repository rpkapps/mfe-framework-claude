/**
 * Mount orchestration — load, attach, retry and disposal under finite deadlines — in one
 * framework-neutral object, so state changes, cancellation and cleanup are traced in one
 * place rather than reconstructed from effects spread across the adapters.
 */

import {
  createMfeError,
  toMfeError,
  type AttemptToken,
  type DeadlineConfig,
  type MfeError,
  type MountHandle,
  type MountState,
  type Unsubscribe,
} from '@company/mfe-core'

import { withDeadline } from '../deadline.ts'
import type { DiagnosticsHub } from '../diagnostics.ts'
import { MountLifecycle } from './mount-lifecycle.ts'

/** `attach` receives whatever `load` resolved; the controller never inspects it. */
export interface MountOperations<TLoaded> {
  /** Runs under the load deadline. */
  load(signal: AbortSignal): Promise<TLoaded>
  /** Runs under the mount deadline, measured after the code is ready. */
  attach(loaded: TLoaded, signal: AbortSignal): Promise<void>
  /**
   * Synchronous, and called before any asynchronous cleanup so the failed or disposed surface
   * disappears immediately.
   */
  detach(): void
  /** Asynchronous cleanup: subscriptions, registrations, child mounts, roots. */
  cleanup(): Promise<void>
}

export interface MountControllerOptions<TLoaded> {
  readonly id: string
  readonly definitionVersion?: string
  readonly operations: MountOperations<TLoaded>
  readonly deadlines: DeadlineConfig
  readonly diagnostics?: DiagnosticsHub
  /** Called once the mount reaches a terminal disposed state. */
  readonly onDisposed?: () => void
}

/** Construction does not start the mount; `start()` does, so the caller picks when. */
export class MountController<TLoaded> implements MountHandle {
  readonly id: string
  readonly #lifecycle: MountLifecycle
  readonly #options: MountControllerOptions<TLoaded>
  /** Identity every error and deadline carries, without an optional-property dance. */
  readonly #identity: { readonly id: string; readonly definitionVersion?: string }
  /** The most recent loaded module, so a retry after a mount failure can skip reloading. */
  #loaded: TLoaded | undefined

  constructor(options: MountControllerOptions<TLoaded>) {
    this.id = options.id
    this.#options = options
    this.#identity = {
      id: options.id,
      ...(options.definitionVersion === undefined
        ? {}
        : { definitionVersion: options.definitionVersion }),
    }
    this.#lifecycle = new MountLifecycle({
      ...this.#identity,
      onListenerError: error => {
        options.diagnostics?.report(
          toMfeError(error, {
            code: 'mount/failure',
            id: options.id,
            operation: 'notify a lifecycle subscriber',
            repair: 'Fix the subscriber; other subscribers were still notified.',
          }),
        )
      },
    })
  }

  get state(): MountState {
    return this.#lifecycle.getState()
  }

  readonly getState = (): MountState => this.#lifecycle.getState()
  readonly subscribe = (listener: () => void): Unsubscribe => this.#lifecycle.subscribe(listener)

  /** Aborts on disposal; this is what authors receive as the mount signal. */
  get signal(): AbortSignal {
    return this.#lifecycle.signal
  }

  get isDisposed(): boolean {
    return this.#lifecycle.isDisposed
  }

  /** Begins the first attempt; safe to await, but callers may ignore the promise. */
  start(): Promise<void> {
    return this.#runAttempt()
  }

  /** Updating props during an initial mount error never retries silently; only this does. */
  retry(): void {
    if (this.#lifecycle.isDisposed) return
    void this.#runAttempt()
  }

  /**
   * Detaches UI synchronously, then completes asynchronous cleanup; every caller awaits the same
   * teardown.
   */
  dispose(): Promise<void> {
    return this.#lifecycle.runDisposalOnce(() => this.#dispose())
  }

  async #runAttempt(): Promise<void> {
    let token: AttemptToken
    try {
      token = this.#lifecycle.beginAttempt()
    } catch (error) {
      // Disposed between the caller's decision and this call.
      this.#report(error)
      return
    }

    try {
      // A retry after a *mount* failure reuses the resolved module: reloading would
      // discard a good download only to re-run a render failure.
      const loaded =
        this.#loaded ??
        (await withDeadline(
          signal => this.#options.operations.load(signal),
          this.#options.deadlines.load,
          { ...this.#identity, operation: 'load container', phase: 'load' },
          { signal: token.signal },
        ))

      if (!token.isCurrent()) return
      this.#loaded = loaded

      await withDeadline(
        signal => this.#options.operations.attach(loaded, signal),
        this.#options.deadlines.mount,
        { ...this.#identity, operation: 'mount definition', phase: 'mount' },
        { signal: token.signal },
      )

      if (!token.isCurrent()) {
        // A superseded attempt may have attached UI before losing the race, which would
        // otherwise leave a tree behind.
        this.#safeDetach()
        return
      }

      this.#lifecycle.settleMounted(token)
    } catch (error) {
      if (!token.isCurrent()) return

      const structured = toMfeError(error, {
        ...this.#identity,
        code: 'mount/failure',
        operation: 'mount definition',
        repair: 'Use the explicit retry action once the underlying cause is fixed.',
      })

      // Detach whatever a failed attach may have attached, then settle.
      this.#safeDetach()
      this.#lifecycle.settleError(token, structured)
      this.#report(structured)
    }
  }

  async #dispose(): Promise<void> {
    const reason = createMfeError({
      ...this.#identity,
      code: 'dispose/failure',
      operation: 'dispose mount',
      observed: 'the host disposed this mount',
      repair: 'No action required; this is the normal teardown signal.',
    })

    // UI detaches synchronously and the lifecycle becomes terminal before any awaiting,
    // so late callbacks are fenced from this point on.
    this.#safeDetach()
    this.#lifecycle.markDisposed(reason)

    try {
      await withDeadline(
        async () => {
          await this.#options.operations.cleanup()
        },
        this.#options.deadlines.dispose,
        { ...this.#identity, operation: 'complete asynchronous cleanup', phase: 'dispose' },
      )
    } catch (error) {
      // The mount stays disposed and late callbacks stay fenced; the promise rejects so
      // the caller learns cleanup did not finish.
      const structured = toMfeError(error, {
        ...this.#identity,
        code: 'dispose/failure',
        operation: 'complete asynchronous cleanup',
        repair:
          'Check the diagnostics for the cleanup step that failed. Other mounts and shell navigation are unaffected.',
      })
      this.#report(structured)
      this.#finish()
      throw structured
    }

    this.#finish()
  }

  #finish(): void {
    this.#loaded = undefined
    this.#options.onDisposed?.()
    this.#lifecycle.dispose()
  }

  /** Every owned cleanup is attempted even if one fails. */
  #safeDetach(): void {
    try {
      this.#options.operations.detach()
    } catch (error) {
      this.#report(
        toMfeError(error, {
          code: 'dispose/failure',
          id: this.id,
          operation: 'detach mounted UI',
          repair: 'Fix the adapter’s detach step; remaining cleanup still ran.',
        }),
      )
    }
  }

  #report(error: unknown): void {
    const structured: MfeError = toMfeError(error, {
      code: 'mount/failure',
      id: this.id,
      operation: 'mount definition',
    })
    this.#options.diagnostics?.report(structured)
  }
}
