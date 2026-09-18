/**
 * The active-span context manager.
 *
 * WHAT THIS IS
 * ------------
 * A single module-scoped "currently active span" slot, saved and restored
 * around the synchronous execution of a `startActiveSpan` callback. Every
 * context entry carries the mount that owns it, so one mount can never become
 * the parent of another mount's span.
 *
 * WHY IT LOOKS LIKE THIS
 * ----------------------
 * Browsers have no AsyncLocalStorage and no AsyncContext. The only ways to
 * follow a context across `await` are (a) patching `Promise.prototype.then` and
 * every task-scheduling global, which is a zone library and is out of scope
 * here, or (b) capturing the context explicitly at the point a continuation is
 * created. We do (b). Node's `node:async_hooks` is deliberately NOT used even
 * though the test runner would happily provide it: it would make correlation
 * pass in Node and silently fail in the browsers this framework actually ships
 * to, which is exactly the false confidence the tracing rules warn about.
 *
 * WHAT IS GUARANTEED
 * ------------------
 * 1. A span created synchronously inside a `startActiveSpan` callback is
 *    parented to that callback's span, to any depth of nesting.
 * 2. `startSpan` uses the active span as its parent but never becomes active
 *    itself, so its own descendants are not silently re-parented.
 * 3. The context is restored exactly once the synchronous portion of the
 *    callback returns or throws, including on a throw.
 * 4. Two mounts running interleaved never share context: parent resolution
 *    demands an owner match.
 * 5. A callback wrapped with `bindTelemetryContext` restores the context that
 *    was active when the wrapper was created, which is how an asynchronous
 *    continuation keeps its parent.
 *
 * WHAT IS NOT GUARANTEED
 * ----------------------
 * A span created after an `await` inside an active callback has NO active
 * context, because the synchronous region ended at the first suspension point.
 * That case yields a root span - no parent - and never an incorrect parent.
 * `Promise.all` over several concurrently started operations has the same
 * shape: each operation's synchronous prologue is correlated, its continuations
 * are not, and no operation can capture another's span. This is a limit of
 * callback syntax in a browser, not something the API hides; use
 * `bindTelemetryContext` on the continuation, or pass the span down and start
 * children from inside a fresh `startActiveSpan`, when a continuation must stay
 * correlated. Verify the paths you depend on against a real build before
 * claiming automatic correlation.
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

/**
 * Runs `fn` with `context` active and restores the previous context afterwards,
 * including when `fn` throws. The restore happens when the synchronous portion
 * of `fn` finishes; an `await` inside `fn` resumes with whatever context the
 * microtask that resumed it happens to have, which is the documented limit
 * above.
 */
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
 * the returned function. This is the supported way to keep a continuation
 * correlated: create the wrapper while the span is still active, then hand the
 * wrapper to the timer, listener or promise callback.
 *
 * Arguments, return value and thrown errors pass through untouched.
 */
export function bindTelemetryContext<A extends readonly unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const captured = activeContext
  return (...args: A): R => runWithSpanContext(captured, () => fn(...args))
}

/** Test-only escape hatch: drops any active context. Never called in a mount. */
export function resetSpanContextForTests(): void {
  activeContext = undefined
}
