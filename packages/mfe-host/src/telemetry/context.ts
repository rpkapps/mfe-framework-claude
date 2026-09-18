/**
 * The active-span context manager: one module-scoped slot, saved and restored
 * around the *synchronous* part of a `startActiveSpan` callback.
 *
 * Browsers have no AsyncLocalStorage and no AsyncContext, and `node:async_hooks`
 * is deliberately unused — it would make correlation pass in Node and silently
 * fail in the browsers this framework ships to.
 */

export interface ActiveSpanContext {
  /** Identity of the mount that owns the span. Compared by reference. */
  readonly owner: object
  readonly traceId: string
  readonly spanId: string
  readonly name: string
}

let activeContext: ActiveSpanContext | undefined

/** The active context, whoever owns it. Diagnostics and tests use this. */
export function getActiveSpanContext(): ActiveSpanContext | undefined {
  return activeContext
}

/**
 * The active context, but only when the given mount owns it. Parent resolution
 * goes through here so that an interleaved mount produces a root span instead
 * of a cross-mount parent.
 */
export function getActiveSpanContextFor(owner: object): ActiveSpanContext | undefined {
  return activeContext !== undefined && activeContext.owner === owner ? activeContext : undefined
}

/** Runs `fn` with `context` active, restoring the previous one even on a throw. */
export function runWithSpanContext<T>(context: ActiveSpanContext | undefined, fn: () => T): T {
  const previous = activeContext
  activeContext = context
  try {
    return fn()
  } finally {
    activeContext = previous
  }
}

/**
 * Captures the active context now and restores it for every later invocation of
 * the returned function. A span started after an `await` has no ambient context
 * and becomes a root — never a wrong parent, but never a child either — so this
 * is the supported way to keep a continuation correlated. Create the wrapper
 * while the span is still active, then hand it to the timer or callback.
 */
export function bindTelemetryContext<A extends readonly unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const captured = activeContext
  return (...args: A): R => runWithSpanContext(captured, () => fn(...args))
}
