/**
 * A recording telemetry provider: the test-only entry point.
 *
 * It implements the provider seam in memory and keeps what it was given, so
 * asserting that a feature emits the right telemetry needs no monitoring
 * account, no vendor SDK and no network. Parentage is rebuilt from the reserved
 * span-id attributes, exactly as a real shell adapter would. Buffers are
 * bounded like a real sink's, and `overflowCount` moves when one overflows.
 */

import {
  EMPTY_ATTRIBUTES,
  SpanKind,
  SpanStatusCode,
  type Span,
  type SpanOptions,
  type SpanRecord,
  type SpanStatus,
  type TelemetryAttributes,
  type TelemetryAttribution,
  type TelemetryEventRecord,
  type TelemetryFrameworkRecord,
  type TelemetryLevel,
  type TelemetryLogRecord,
  type TelemetryMeasurementRecord,
  type TelemetryProvider,
  type TelemetryRecord,
} from '@company/mfe-core'

import { RESERVED_ATTRIBUTE_KEYS } from './runtime.ts'

/** A `SpanRecord` while it is still being written to. */
interface MutableSpanRecord {
  name: string
  kind: SpanKind
  attributes: TelemetryAttributes
  attribution: TelemetryAttribution
  startTime: number
  endTime?: number
  status: SpanStatus
  events: { name: string; attributes: TelemetryAttributes; timestamp: number }[]
  exceptions: unknown[]
  parent?: SpanRecord
}

export interface RecordingProviderOptions {
  /** Levels the provider admits. Omit for "everything". */
  readonly enabledLevels?: readonly TelemetryLevel[]
  /** Bounded buffer size for records and for spans. Defaults to 1000 each. */
  readonly limit?: number
  /** Injectable clock, for deterministic tests. */
  readonly now?: () => number
}

export interface RecordingTelemetryProvider extends TelemetryProvider {
  readonly records: readonly TelemetryRecord[]
  readonly spans: readonly SpanRecord[]
  /** Entries dropped because a bounded buffer was full. */
  readonly overflowCount: number
  /** How many times the host asked for a tracer. One per mount with tracing on. */
  readonly tracerCount: number

  events(name?: string): readonly TelemetryEventRecord[]
  logs(level?: TelemetryLevel): readonly TelemetryLogRecord[]
  measurements(name?: string): readonly TelemetryMeasurementRecord[]
  frameworkRecords(operation?: string): readonly TelemetryFrameworkRecord[]
  spansNamed(name: string): readonly SpanRecord[]
  endedSpans(): readonly SpanRecord[]
  openSpans(): readonly SpanRecord[]

  clear(): void
  /** Makes `record()` throw, always or for the records a predicate selects. */
  failRecords(mode: boolean | ((record: TelemetryRecord) => boolean)): void
  /** Makes `createTracer()` throw, as a provider with a broken tracing setup would. */
  failTracerCreation(fail: boolean): void
  /** Replaces the level filter. `undefined` admits every level again. */
  setEnabledLevels(levels: readonly TelemetryLevel[] | undefined): void
}

export function createRecordingTelemetryProvider(
  options: RecordingProviderOptions = {},
): RecordingTelemetryProvider {
  const limit = options.limit ?? 1000
  const now = options.now ?? Date.now

  const records: TelemetryRecord[] = []
  const spans: MutableSpanRecord[] = []
  const spansById = new Map<string, MutableSpanRecord>()

  let overflowCount = 0
  let tracerCount = 0
  let enabledLevels = options.enabledLevels
  let recordFailure: ((record: TelemetryRecord) => boolean) | null = null
  let tracerFailure = false

  /** Records of one kind, optionally narrowed by the field that names them. */
  const select = <T>(kind: string, field: string, match: string | undefined): readonly T[] =>
    records.filter(
      record =>
        record.kind === kind &&
        (match === undefined || (record as unknown as Record<string, unknown>)[field] === match),
    ) as unknown as readonly T[]

  function startSpan(attribution: TelemetryAttribution, name: string, given?: SpanOptions): Span {
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

    const parent = spansById.get(String(attributes[RESERVED_ATTRIBUTE_KEYS.parentSpanId]))
    if (parent !== undefined) record.parent = parent
    const spanId = attributes[RESERVED_ATTRIBUTE_KEYS.spanId]
    if (typeof spanId === 'string') spansById.set(spanId, record)

    if (spans.length >= limit) {
      overflowCount += 1
      const evictedId = spans.shift()?.attributes[RESERVED_ATTRIBUTE_KEYS.spanId]
      if (typeof evictedId === 'string') spansById.delete(evictedId)
    }
    spans.push(record)

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
        // that keeps the attributes visible to a test.
        return span.addEvent('exception', exceptionAttributes)
      },
      end: endTime => {
        if (record.endTime === undefined) record.endTime = endTime ?? now()
      },
      isRecording: () => record.endTime === undefined,
    }
    return span
  }

  const provider: RecordingTelemetryProvider = {
    record: record => {
      if (recordFailure !== null && recordFailure(record)) {
        throw new Error(`recording provider: record() is configured to fail for ${record.kind}`)
      }
      if (records.length >= limit) {
        records.shift()
        overflowCount += 1
      }
      records.push(record)
    },

    createTracer: attribution => {
      tracerCount += 1
      if (tracerFailure) throw new Error('recording provider: createTracer is configured to fail')
      const start = (name: string, given?: SpanOptions): Span => startSpan(attribution, name, given)
      // The host owns context and never calls startActiveSpan, but a provider
      // must still honour the contract: the callback runs exactly once and its
      // result is returned unchanged.
      return {
        startSpan: start,
        startActiveSpan: <T>(
          name: string,
          optionsOrCallback: SpanOptions | ((span: Span) => T),
          maybeCallback?: (span: Span) => T,
        ): T => {
          const given = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback
          const callback =
            typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
          if (typeof callback !== 'function') return undefined as unknown as T
          return callback(start(name, given))
        },
      }
    },

    isLevelEnabled: level => enabledLevels === undefined || enabledLevels.includes(level),

    get records() {
      return records
    },
    get spans() {
      return spans
    },
    get overflowCount() {
      return overflowCount
    },
    get tracerCount() {
      return tracerCount
    },

    events: name => select('event', 'name', name),
    logs: level => select('log', 'level', level),
    measurements: name => select('measurement', 'name', name),
    frameworkRecords: operation => select('framework', 'operation', operation),
    spansNamed: name => spans.filter(span => span.name === name),
    endedSpans: () => spans.filter(span => span.endTime !== undefined),
    openSpans: () => spans.filter(span => span.endTime === undefined),

    clear: () => {
      records.length = 0
      spans.length = 0
      spansById.clear()
      overflowCount = 0
    },
    failRecords: mode => {
      recordFailure = mode === false ? null : mode === true ? () => true : mode
    },
    failTracerCreation: fail => {
      tracerFailure = fail
    },
    setEnabledLevels: levels => {
      enabledLevels = levels
    },
  }

  return provider
}
