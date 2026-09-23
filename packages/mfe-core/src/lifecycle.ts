/**
 * Mount lifecycle states and the neutral handle a host or component observes.
 * `MountLifecycle`, the one object owning every legal transition between them, lives in
 * `@company/mfe-runtime`; nothing here does anything, so a framework-neutral package can hold
 * it as a pure contract.
 */

import type { MfeError } from './errors.ts'
import type { Unsubscribe } from './observable.ts'

export type MountState =
  | { readonly status: 'pending'; readonly attempt: number }
  | { readonly status: 'mounted' }
  | { readonly status: 'error'; readonly error: MfeError }
  | { readonly status: 'disposed' }

/** Async steps check `isCurrent` first, so a superseded attempt can never overwrite a newer one. */
export interface AttemptToken {
  readonly attempt: number
  isCurrent(): boolean
  /** Aborts when this attempt is superseded, or when the mount is disposed. */
  readonly signal: AbortSignal
}

/** The public lifecycle surface a host component or non-React host observes. */
export interface MountHandle {
  readonly id: string
  readonly state: MountState
  getState(): MountState
  subscribe(listener: () => void): Unsubscribe
  /** Starts a fresh attempt using the latest committed inputs. */
  retry(): void
  /**
   * Idempotent; resolves when cleanup finishes. `MountController` is the implementation
   * that rejects with `dispose/timeout`, because it is the one that runs disposal under a
   * deadline. The React adapter's own handle never rejects and imposes no deadline.
   */
  dispose(): Promise<void>
}
