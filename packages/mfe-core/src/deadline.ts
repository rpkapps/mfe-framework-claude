/**
 * One phase's time budget: load, mount and dispose each get their own field. `withDeadline`, the
 * function that enforces it, lives in `@company/mfe-runtime`.
 */

export interface DeadlineConfig {
  readonly load: number
  /** One mount attempt, measured after its code is ready. */
  readonly mount: number
  readonly dispose: number
}
