/**
 * The page's active span slot. On the page rather than in a module: a page may hold more than one
 * copy of the runtime (§55), and a context one copy made active is the active context to every
 * other.
 */

import type { Tracer } from '@company/mfe-core'

export interface ActiveSpanContext {
  /** Identity of the mount that owns the span, compared by reference. */
  readonly owner: object
  readonly traceId: string
  readonly spanId: string
  readonly name: string
  /** The owning mount's tracer, so a request sent inside can start its client span there. */
  readonly tracer: Tracer
}

const ACTIVE_SPAN = Symbol.for('@company/mfe.activeSpan')

interface PageSpan {
  [ACTIVE_SPAN]?: ActiveSpanContext | undefined
}

const page = globalThis as PageSpan

/** The active context, whoever owns it. */
export function getActiveSpanContext(): ActiveSpanContext | undefined {
  return page[ACTIVE_SPAN]
}

/**
 * Parent resolution goes through here so that an interleaved mount produces a root span
 * instead of a cross-mount parent (§4).
 */
export function getActiveSpanContextFor(owner: object): ActiveSpanContext | undefined {
  const active = page[ACTIVE_SPAN]
  return active !== undefined && active.owner === owner ? active : undefined
}

/** Runs `fn` with `context` active, restoring the previous one even on a throw. */
export function runWithSpanContext<T>(context: ActiveSpanContext | undefined, fn: () => T): T {
  const previous = page[ACTIVE_SPAN]
  page[ACTIVE_SPAN] = context
  try {
    return fn()
  } finally {
    page[ACTIVE_SPAN] = previous
  }
}
