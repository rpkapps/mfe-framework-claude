/**
 * Finite deadlines for loading, mounting and disposal (§7.4).
 *
 * These are operational defaults, not performance targets. Each phase gets one
 * total deadline so individual substeps cannot reset the clock indefinitely.
 */

import { createMfeError, type MfeError, type MfeErrorCode } from './errors.ts'

export interface DeadlineConfig {
  /** Loading, config fetch and bootstrap work. */
  readonly load: number
  /** One mount attempt, measured after its code is ready. */
  readonly mount: number
  /** Asynchronous disposal. */
  readonly dispose: number
}

/** Documented initial defaults (§7.4). The shell may tune them centrally. */
export const DEFAULT_DEADLINES: DeadlineConfig = Object.freeze({
  load: 30_000,
  mount: 30_000,
  dispose: 5_000,
})

export interface DeadlineContext {
  readonly id: string
  readonly definitionVersion?: string
  readonly operation: string
  readonly phase: 'load' | 'mount' | 'dispose'
}

const TIMEOUT_CODES: Record<DeadlineContext['phase'], MfeErrorCode> = {
  load: 'load/timeout',
  mount: 'mount/timeout',
  dispose: 'dispose/timeout',
}

export function createTimeoutError(
  context: DeadlineContext,
  elapsedMs: number,
  deadlineMs: number,
): MfeError {
  return createMfeError({
    code: TIMEOUT_CODES[context.phase],
    id: context.id,
    ...(context.definitionVersion === undefined
      ? {}
      : { definitionVersion: context.definitionVersion }),
    operation: context.operation,
    expected: `the ${context.phase} phase to settle within ${deadlineMs}ms`,
    observed: `it was still running after ${Math.round(elapsedMs)}ms`,
    declaredBy: 'The shell-configured deadline policy',
    repair:
      context.phase === 'dispose'
        ? 'The mount is disposed and late callbacks are fenced; check the diagnostics for the cleanup step that did not finish.'
        : 'Check the network panel for the request that did not settle, then use the explicit retry action.',
  })
}

/**
 * Races `work` against a total deadline.
 *
 * `onTimeout` runs before the returned promise rejects so the caller can abort
 * cancellable work and detach incomplete UI in the same turn. The underlying
 * promise is always observed, so a late rejection cannot surface as an
 * unhandled rejection (§7.4).
 */
export async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  deadlineMs: number,
  context: DeadlineContext,
  options: { readonly signal?: AbortSignal; readonly onTimeout?: (error: MfeError) => void } = {},
): Promise<T> {
  const controller = new AbortController()
  const startedAt = Date.now()

  const abortOuter = (): void => controller.abort(options.signal?.reason)
  if (options.signal) {
    if (options.signal.aborted) controller.abort(options.signal.reason)
    else options.signal.addEventListener('abort', abortOuter, { once: true })
  }

  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        const error = createTimeoutError(context, Date.now() - startedAt, deadlineMs)
        controller.abort(error)
        options.onTimeout?.(error)
        reject(error)
      }, deadlineMs)

      work(controller.signal).then(resolve, reject)
    })
  } finally {
    // Cleared on every success, error and timeout path (§7.4).
    if (timer !== undefined) clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortOuter)
  }
}
