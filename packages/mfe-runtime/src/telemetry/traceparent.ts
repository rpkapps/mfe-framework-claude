/**
 * The W3C `traceparent` header, written by a workflow's `headers()` and by the framework fetch,
 * and read back from a caller's request so the fetch's span can join the trace it names.
 */

import type { TelemetrySpanContext } from '@company/mfe-core'

/** Version 00 with the sampled flag: sampling is the shell's to decide downstream. */
export function formatTraceparent(context: TelemetrySpanContext): string {
  return `00-${context.traceId}-${context.spanId}-01`
}

const TRACEPARENT = /^([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-[\da-f]{2}(-.*)?$/

/**
 * `undefined` for a header the spec says to ignore: version ff, an all-zero id, or the wrong
 * shape. A later version may append fields, which are read past; version 00 may not.
 */
export function parseTraceparent(value: string): TelemetrySpanContext | undefined {
  const match = TRACEPARENT.exec(value.trim())
  if (match === null) return undefined
  const [, version, traceId, spanId, rest] = match
  if (version === undefined || traceId === undefined || spanId === undefined) return undefined
  if (version === 'ff' || (version === '00' && rest !== undefined)) return undefined
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return undefined
  return Object.freeze({ traceId, spanId })
}
