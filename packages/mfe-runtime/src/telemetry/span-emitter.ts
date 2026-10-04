/**
 * The one span implementation in the repo: the emitter owns span state, `end()` idempotency and
 * the per-mount open-span bound, so a provider supplies only what it does with a `SpanRecord`.
 */

import {
  EMPTY_ATTRIBUTES,
  SpanKind,
  SpanStatusCode,
  TELEMETRY_LIMITS,
  type Span,
  type SpanRecord,
  type TelemetryAttribution,
  type Tracer,
} from '@company/mfe-core'

import { RESERVED_ATTRIBUTE_KEYS } from './runtime.ts'

/** One frozen instance: the handle carries no state, so a disabled mount allocates nothing. */
const nonRecordingSpan: Span = Object.freeze({
  setAttributes: (): Span => nonRecordingSpan,
  setStatus: (): Span => nonRecordingSpan,
  recordException: (): Span => nonRecordingSpan,
  end: (): void => {},
})

export function createNonRecordingTracer(): Tracer {
  return Object.freeze({ startSpan: (): Span => nonRecordingSpan })
}

type MutableSpanRecord = {
  -readonly [K in keyof SpanRecord]: K extends 'events' ? SpanRecord[K][number][] : SpanRecord[K]
}

export interface SpanEmitterOptions {
  /** Injectable clock for deterministic tests; defaults to `Date.now`. */
  readonly now?: () => number
  /** The record this span will fill in, handed over while the span is still open. */
  readonly onSpanStart?: (span: SpanRecord) => void
  readonly onSpanEnd?: (span: SpanRecord) => void
}

/**
 * A recording `Tracer` for one mount's attribution. Parentage crosses the provider seam
 * only as the host-reserved span ids on the attributes, so the tree is rebuilt from them
 * here rather than in every shell adapter.
 */
export function createSpanEmitter(
  attribution: TelemetryAttribution,
  options: SpanEmitterOptions = {},
): Tracer {
  const now = options.now ?? Date.now
  const open = new Set<MutableSpanRecord>()
  /** Recently started spans by id, bounded the same way open spans are. */
  const byId = new Map<string, MutableSpanRecord>()

  const startSpan: Tracer['startSpan'] = (name, given) => {
    // Past the budget the caller still gets a usable handle, but nothing is kept: spans
    // nobody ends must not grow memory without limit.
    if (open.size >= TELEMETRY_LIMITS.maxOpenSpansPerMount) return nonRecordingSpan

    const attributes = given?.attributes ?? EMPTY_ATTRIBUTES
    const record: MutableSpanRecord = {
      name,
      kind: given?.kind ?? SpanKind.INTERNAL,
      attributes,
      attribution,
      startTime: now(),
      status: { code: SpanStatusCode.UNSET },
      events: [],
    }

    const parentSpanId = attributes[RESERVED_ATTRIBUTE_KEYS.parentSpanId]
    if (typeof parentSpanId === 'string') record.parentSpanId = parentSpanId
    const parent = byId.get(String(parentSpanId))
    if (parent !== undefined) record.parent = parent
    const id = attributes[RESERVED_ATTRIBUTE_KEYS.spanId]
    const traceId = attributes[RESERVED_ATTRIBUTE_KEYS.traceId]
    if (typeof id === 'string' && typeof traceId === 'string') {
      record.spanContext = Object.freeze({ traceId, spanId: id })
    }
    if (typeof id === 'string') {
      if (byId.size >= TELEMETRY_LIMITS.maxOpenSpansPerMount) {
        const oldest = oldestKey(byId.keys())
        if (oldest !== undefined) byId.delete(oldest)
      }
      byId.set(id, record)
    }

    open.add(record)
    options.onSpanStart?.(record)

    const span: Span = {
      setAttributes: added => {
        record.attributes = Object.freeze({ ...record.attributes, ...added })
        return span
      },
      setStatus: status => {
        record.status = status
        return span
      },
      // OpenTelemetry models an exception as an event on the span. The error itself is not kept:
      // a failed workflow reports it as an error record linked to the span, and a failed request
      // rejects to its caller.
      recordException: () => {
        record.events.push({ name: 'exception', attributes: EMPTY_ATTRIBUTES, timestamp: now() })
        return span
      },
      // Repeated calls are harmless: the first one wins and the rest do nothing.
      end: endTime => {
        if (record.endTime !== undefined) return
        record.endTime = endTime ?? now()
        open.delete(record)
        options.onSpanEnd?.(record)
      },
    }
    return span
  }
  return Object.freeze({ startSpan })
}

/** The oldest key in a Map, which iterates in insertion order. */
function oldestKey(keys: Iterable<string>): string | undefined {
  for (const key of keys) return key
  return undefined
}
