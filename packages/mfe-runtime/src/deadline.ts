/** Each phase gets one total deadline, so individual substeps cannot reset the clock. */

import {
  createMfeError,
  type DeadlineConfig,
  type MfeError,
  type MfeErrorCode,
} from '@company/mfe-core'

export interface DeadlineContext {
  readonly id: string
  readonly definitionVersion?: string
  readonly operation: string
  readonly phase: 'load' | 'mount' | 'dispose'
}

/** Initial defaults; the shell may tune them centrally. */
export const DEFAULT_DEADLINES: DeadlineConfig = Object.freeze({
  load: 30_000,
  mount: 30_000,
  dispose: 5_000,
})

const TIMEOUT_CODES: Record<DeadlineContext['phase'], MfeErrorCode> = {
  load: 'load/timeout',
  mount: 'mount/timeout',
  dispose: 'dispose/timeout',
}

/**
 * `onTimeout` runs before the rejection so a caller can abort and detach in the same turn, and the
 * underlying promise is always observed so a late rejection cannot surface as unhandled.
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
        const error = createMfeError({
          code: TIMEOUT_CODES[context.phase],
          id: context.id,
          ...(context.definitionVersion === undefined
            ? {}
            : { definitionVersion: context.definitionVersion }),
          operation: context.operation,
          expected: `the ${context.phase} phase to settle within ${deadlineMs}ms`,
          observed: `it was still running after ${Math.round(Date.now() - startedAt)}ms`,
          repair:
            context.phase === 'dispose'
              ? 'Check the diagnostics for the cleanup step that did not finish.'
              : 'Check the network panel for the request that did not settle, then retry.',
        })
        controller.abort(error)
        options.onTimeout?.(error)
        reject(error)
      }, deadlineMs)

      work(controller.signal).then(resolve, reject)
    })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortOuter)
  }
}
