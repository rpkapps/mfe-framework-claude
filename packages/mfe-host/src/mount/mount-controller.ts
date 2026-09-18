/**
 * Mount orchestration: load, attach, retry and disposal, under finite deadlines.
 *
 * One object owns the whole operation so a maintainer can trace a mount's state
 * changes, cancellation and cleanup in one place instead of reconstructing them
 * from effects spread across the adapters.
 *
 * The controller is framework-neutral. The adapter supplies three callbacks —
 * load, attach and cleanup — and this class decides when they run, what
 * cancels them, and which results are still current.
 */

import {
  createMfeError,
  MountLifecycle,
  toMfeError,
  withDeadline,
  type AttemptToken,
  type DeadlineConfig,
  type DiagnosticsHub,
  type MfeError,
  type MountHandle,
  type MountState,
  type Unsubscribe,
} from '@company/mfe-core'

/**
 * What the owning adapter must provide. `attach` receives whatever `load`
 * resolved, so the controller never inspects the module itself.
 */
export interface MountOperations<TLoaded> {
  /** Resolve the definition's code. Runs under the load deadline. */
  load(signal: AbortSignal): Promise<TLoaded>
  /** Render it. Runs under the mount deadline, measured after the code is ready. */
  attach(loaded: TLoaded, signal: AbortSignal): Promise<void>
  /**
   * Detach UI synchronously. Called before any asynchronous cleanup so the
   * failed or disposed surface disappears immediately.
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

/**
 * Drives one mount. Construction does not start it; call `start()` so the
 * caller controls when the first attempt begins.
 */
export class MountController<TLoaded> implements MountHandle {
  readonly id: string
  readonly #lifecycle: MountLifecycle
  readonly #options: MountControllerOptions<TLoaded>
  /** The most recent loaded module, so a retry after a mount failure can skip reloading. */
  #loaded: TLoaded | undefined

  constructor(options: MountControllerOptions<TLoaded>) {
    this.id = options.id
    this.#options = options
    this.#lifecycle = new MountLifecycle({
      id: options.id,
      ...(options.definitionVersion === undefined
        ? {}
        : { definitionVersion: options.definitionVersion }),
      onListenerError: error => {
        options.diagnostics?.report(
          toMfeError(error, {
            code: 'mount/failure',
            id: options.id,
            operation: 'notify a lifecycle subscriber',
            declaredBy: 'A lifecycle subscriber',
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

  /** Aborts on disposal. This is what authors receive as the mount signal. */
  get signal(): AbortSignal {
    return this.#lifecycle.signal
  }

  get isDisposed(): boolean {
    return this.#lifecycle.isDisposed
  }

  /** Begins the first attempt. Safe to await, but callers may ignore the promise. */
  start(): Promise<void> {
    return this.#runAttempt()
  }

  /**
   * Starts a fresh attempt with the latest committed inputs. Updating props
   * during an initial mount error never retries silently; only this does.
   */
  retry(): void {
    if (this.#lifecycle.isDisposed) return
    void this.#runAttempt()
  }

  /**
   * Detaches UI synchronously, then completes asynchronous cleanup. Idempotent:
   * every caller awaits the same teardown.
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
      // A retry after a *mount* failure reuses the already-resolved module.
      // Retry does not recreate the container, and reloading it would discard a
      // perfectly good download only to re-run a render failure.
      const loaded =
        this.#loaded ??
        (await withDeadline(
          signal => this.#options.operations.load(signal),
          this.#options.deadlines.load,
          {
            id: this.id,
            ...(this.#options.definitionVersion === undefined
              ? {}
              : { definitionVersion: this.#options.definitionVersion }),
            operation: 'load container',
            phase: 'load',
          },
          { signal: token.signal },
        ))

      if (!token.isCurrent()) return
      this.#loaded = loaded

      await withDeadline(
        signal => this.#options.operations.attach(loaded, signal),
        this.#options.deadlines.mount,
        {
          id: this.id,
          ...(this.#options.definitionVersion === undefined
            ? {}
            : { definitionVersion: this.#options.definitionVersion }),
          operation: 'mount definition',
          phase: 'mount',
        },
        { signal: token.signal },
      )

      if (!token.isCurrent()) {
        // A superseded attempt may have attached UI before losing the race.
        // Detaching here prevents a timed-out attempt from leaving a tree behind.
        this.#safeDetach()
        return
      }

      this.#lifecycle.settleMounted(token)
    } catch (error) {
      if (!token.isCurrent()) return

      const structured = toMfeError(error, {
        code: 'mount/failure',
        id: this.id,
        ...(this.#options.definitionVersion === undefined
          ? {}
          : { definitionVersion: this.#options.definitionVersion }),
        operation: 'mount definition',
        declaredBy: 'The framework mount controller',
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
      code: 'dispose/failure',
      id: this.id,
      ...(this.#options.definitionVersion === undefined
        ? {}
        : { definitionVersion: this.#options.definitionVersion }),
      operation: 'dispose mount',
      observed: 'the host disposed this mount',
      repair: 'No action required; this is the normal teardown signal.',
    })

    // UI detaches synchronously and the lifecycle becomes terminal before any
    // awaiting, so late callbacks are fenced from this point on.
    this.#safeDetach()
    this.#lifecycle.markDisposed(reason)

    try {
      await withDeadline(
        async () => {
          await this.#options.operations.cleanup()
        },
        this.#options.deadlines.dispose,
        {
          id: this.id,
          ...(this.#options.definitionVersion === undefined
            ? {}
            : { definitionVersion: this.#options.definitionVersion }),
          operation: 'complete asynchronous cleanup',
          phase: 'dispose',
        },
      )
    } catch (error) {
      // The mount stays disposed and late callbacks stay fenced; the promise
      // rejects so the caller learns cleanup did not finish.
      const structured = toMfeError(error, {
        code: 'dispose/failure',
        id: this.id,
        ...(this.#options.definitionVersion === undefined
          ? {}
          : { definitionVersion: this.#options.definitionVersion }),
        operation: 'complete asynchronous cleanup',
        declaredBy: 'The framework mount controller',
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
          declaredBy: 'The owning adapter',
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
