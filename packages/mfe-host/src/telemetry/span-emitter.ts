/**
 * The one span implementation in the repo, and the non-recording handle.
 *
 * `TelemetryProvider.createTracer` asks every provider for a `Tracer` and a
 * `Span`. Rather than each provider writing that again, it builds on
 * `createSpanEmitter`: the emitter owns span state, `end()` idempotency, the
 * per-mount open-span bound and the `startActiveSpan` callback contract, and a
 * provider supplies only what it does with a `SpanRecord`.
 */

import {
  EMPTY_ATTRIBUTES,
  SpanKind,
  SpanStatusCode,
  TELEMETRY_LIMITS,
  type Span,
  type SpanOptions,
  type SpanRecord,
  type TelemetryAttribution,
  type Tracer,
} from '@company/mfe-core'

import { RESERVED_ATTRIBUTE_KEYS } from './runtime.ts'

/** One frozen instance: the handle carries no state, so a disabled mount allocates nothing. */
export const nonRecordingSpan: Span = Object.freeze({
  setAttribute: (): Span => nonRecordingSpan,
  setAttributes: (): Span => nonRecordingSpan,
  addEvent: (): Span => nonRecordingSpan,
  setStatus: (): Span => nonRecordingSpan,
  recordException: (): Span => nonRecordingSpan,
  end: (): void => {},
  isRecording: (): boolean => false,
})

/** Splits the two `startActiveSpan` overloads into their parts. */
function activeSpanArgs<T>(
  optionsOrCallback: SpanOptions | ((span: Span) => T),
  maybeCallback: ((span: Span) => T) | undefined,
): { options: SpanOptions | undefined; callback: ((span: Span) => T) | undefined } {
  return typeof optionsOrCallback === 'function'
    ? { options: undefined, callback: optionsOrCallback }
    : { options: optionsOrCallback, callback: maybeCallback }
}

/**
 * Turns a `startSpan` into the whole `Tracer` surface. `startActiveSpan` runs
 * the callback exactly once and returns its result unchanged, whatever the
 * tracer does with the span.
 */
function asTracer(startSpan: (name: string, options?: SpanOptions) => Span): Tracer {
  return Object.freeze({
    startSpan,
    startActiveSpan: <T>(
      name: string,
      optionsOrCallback: SpanOptions | ((span: Span) => T),
      maybeCallback?: (span: Span) => T,
    ): T => {
      const { options, callback } = activeSpanArgs(optionsOrCallback, maybeCallback)
      if (typeof callback !== 'function') return undefined as unknown as T
      return callback(options === undefined ? startSpan(name) : startSpan(name, options))
    },
  }) as Tracer
}

/**
 * A tracer whose spans never record: what a caller gets when tracing is off,
 * when the mount is disposed, when the provider's tracer could not be built, or
 * when the open-span budget is exhausted. Turning tracing off cannot change
 * what the application does, so the callback still runs exactly once.
 */
export function createNonRecordingTracer(): Tracer {
  return asTracer(() => nonRecordingSpan)
}

/** A `SpanRecord` while the emitter is still filling it in. */
type MutableSpanRecord = {
  -readonly [K in keyof SpanRecord]: K extends 'events' | 'exceptions'
    ? SpanRecord[K][number][]
    : SpanRecord[K]
}

export interface SpanEmitterOptions {
  /** Injectable clock, for deterministic tests. Defaults to `Date.now`. */
  readonly now?: () => number
  /** The record this span will fill in, handed over while the span is still open. */
  readonly onSpanStart?: (span: SpanRecord) => void
  /** The same record, once the span has ended. */
  readonly onSpanEnd?: (span: SpanRecord) => void
}

/**
 * A recording `Tracer` for one mount's attribution.
 *
 * Parentage crosses the provider seam only as the host-reserved span ids on the
 * attributes — the seam has no way to say "under that parent" — so the tree is
 * rebuilt from them here, which is what a shell adapter would otherwise repeat.
 */
export function createSpanEmitter(
  attribution: TelemetryAttribution,
  options: SpanEmitterOptions = {},
): Tracer {
  const now = options.now ?? Date.now
  const open = new Set<MutableSpanRecord>()
  /** Recently started spans by id, bounded the same way open spans are. */
  const byId = new Map<string, MutableSpanRecord>()

  return asTracer((name, given) => {
    // Past the budget the caller still gets a usable handle, but nothing is
    // kept: spans nobody ends must not grow memory without limit.
    if (open.size >= TELEMETRY_LIMITS.maxOpenSpansPerMount) return nonRecordingSpan

    const attributes = given?.attributes ?? EMPTY_ATTRIBUTES
    const record: MutableSpanRecord = {
      name,
      kind: given?.kind ?? SpanKind.INTERNAL,
      attributes,
      attribution,
      startTime: given?.startTime ?? now(),
      status: { code: SpanStatusCode.UNSET },
      events: [],
      exceptions: [],
    }

    const parent = byId.get(String(attributes[RESERVED_ATTRIBUTE_KEYS.parentSpanId]))
    if (parent !== undefined) record.parent = parent
    const id = attributes[RESERVED_ATTRIBUTE_KEYS.spanId]
    if (typeof id === 'string') {
      if (byId.size >= TELEMETRY_LIMITS.maxOpenSpansPerMount) {
        byId.delete(at(byId.keys()))
      }
      byId.set(id, record)
    }

    open.add(record)
    options.onSpanStart?.(record)

    const span: Span = {
      setAttribute: (key, value) => {
        record.attributes = Object.freeze({ ...record.attributes, [key]: value })
        return span
      },
      setAttributes: added => {
        record.attributes = Object.freeze({ ...record.attributes, ...added })
        return span
      },
      addEvent: (eventName, eventAttributes) => {
        record.events.push({
          name: eventName,
          attributes: eventAttributes ?? EMPTY_ATTRIBUTES,
          timestamp: now(),
        })
        return span
      },
      setStatus: status => {
        record.status = status
        return span
      },
      recordException: (error, exceptionAttributes) => {
        record.exceptions.push(error)
        // OpenTelemetry models an exception as an event on the span; mirroring
        // that keeps the attributes visible to whatever reads the record.
        return span.addEvent('exception', exceptionAttributes)
      },
      // Repeated calls are harmless: the first one wins and the rest do nothing.
      end: endTime => {
        if (record.endTime !== undefined) return
        record.endTime = endTime ?? now()
        open.delete(record)
        options.onSpanEnd?.(record)
      },
      isRecording: () => record.endTime === undefined,
    }
    return span
  })
}

/** The first key of an iterator, which a bounded map always has. */
function at(keys: IterableIterator<string>): string {
  const first: string | undefined = keys.next().value
  return first ?? ''
}
