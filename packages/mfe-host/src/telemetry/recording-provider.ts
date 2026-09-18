/**
 * A recording telemetry provider for tests.
 *
 * It implements the whole provider seam in memory and keeps what it was given,
 * so verifying that a feature emits the right telemetry needs no monitoring
 * account, no vendor SDK and no network. Parentage is rebuilt from the reserved
 * span-id attributes, exactly as a real shell adapter would. The buffers are
 * bounded like a real sink's, and `overflowCount` moves when they overflow.
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
  type TelemetryRecordKind,
  type Tracer,
} from '@company/mfe-core'

import { RESERVED_ATTRIBUTE_KEYS } from './attribution.ts'

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

  recordsOfKind<K extends TelemetryRecordKind>(
    kind: K,
  ): readonly Extract<TelemetryRecord, { kind: K }>[]
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
  let enabledLevels: readonly TelemetryLevel[] | undefined = options.enabledLevels
  let recordFailure: ((record: TelemetryRecord) => boolean) | null = null
  let tracerFailure = false

  function createTracer(attribution: TelemetryAttribution): Tracer {
    tracerCount += 1
    if (tracerFailure) throw new Error('recording provider: createTracer is configured to fail')

    function startSpan(name: string, spanOptions?: SpanOptions): Span {
      const attributes = spanOptions?.attributes ?? EMPTY_ATTRIBUTES
      const record: MutableSpanRecord = {
        name,
        kind: spanOptions?.kind ?? SpanKind.INTERNAL,
        attributes,
        attribution,
        startTime: spanOptions?.startTime ?? now(),
        status: { code: SpanStatusCode.UNSET },
        events: [],
        exceptions: [],
      }

      const parentId = attributes[RESERVED_ATTRIBUTE_KEYS.parentSpanId]
      if (typeof parentId === 'string') {
        const parent = spansById.get(parentId)
        if (parent !== undefined) record.parent = parent
      }
      const spanId = attributes[RESERVED_ATTRIBUTE_KEYS.spanId]
      if (typeof spanId === 'string') spansById.set(spanId, record)

      if (spans.length >= limit) {
        const evicted = spans.shift()
        overflowCount += 1
        const evictedId = evicted?.attributes[RESERVED_ATTRIBUTE_KEYS.spanId]
        if (typeof evictedId === 'string') spansById.delete(evictedId)
      }
      spans.push(record)

      const span: Span = {
        setAttribute: (key, value) => {
          record.attributes = Object.freeze({ ...record.attributes, [key]: value })
          return span
        },
        setAttributes: attributesToAdd => {
          record.attributes = Object.freeze({ ...record.attributes, ...attributesToAdd })
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
          record.events.push({
            name: 'exception',
            attributes: exceptionAttributes ?? EMPTY_ATTRIBUTES,
            timestamp: now(),
          })
          return span
        },
        end: endTime => {
          if (record.endTime === undefined) record.endTime = endTime ?? now()
        },
        isRecording: () => record.endTime === undefined,
      }
      return span
    }

    // The host owns context and never calls this, but a provider must still
    // honour the contract: the callback runs exactly once and its result is
    // returned unchanged.
    function startActiveSpan<T>(name: string, callback: (span: Span) => T): T
    function startActiveSpan<T>(
      name: string,
      spanOptions: SpanOptions,
      callback: (span: Span) => T,
    ): T
    function startActiveSpan<T>(
      name: string,
      optionsOrCallback: SpanOptions | ((span: Span) => T),
      maybeCallback?: (span: Span) => T,
    ): T {
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
      const spanOptions = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback
      if (typeof callback !== 'function') return undefined as unknown as T
      return callback(spanOptions === undefined ? startSpan(name) : startSpan(name, spanOptions))
    }

    return { startSpan, startActiveSpan }
  }

  /** Records of one kind, optionally narrowed by the field that names them. */
  function selectRecords<K extends TelemetryRecordKind>(
    kind: K,
    field: 'name' | 'level' | 'operation',
    match: string | undefined,
  ): Extract<TelemetryRecord, { kind: K }>[] {
    return records.filter(
      record =>
        record.kind === kind &&
        (match === undefined || (record as unknown as Record<string, unknown>)[field] === match),
    ) as Extract<TelemetryRecord, { kind: K }>[]
  }

  const provider: RecordingTelemetryProvider = {
    record(record: TelemetryRecord): void {
      if (recordFailure !== null && recordFailure(record)) {
        throw new Error(`recording provider: record() is configured to fail for ${record.kind}`)
      }
      if (records.length >= limit) {
        records.shift()
        overflowCount += 1
      }
      records.push(record)
    },
    createTracer,
    isLevelEnabled: level => enabledLevels === undefined || enabledLevels.includes(level),

    get records(): readonly TelemetryRecord[] {
      return records
    },
    get spans(): readonly SpanRecord[] {
      return spans
    },
    get overflowCount(): number {
      return overflowCount
    },
    get tracerCount(): number {
      return tracerCount
    },

    recordsOfKind: kind => selectRecords(kind, 'name', undefined),
    events: name => selectRecords('event', 'name', name),
    logs: level => selectRecords('log', 'level', level),
    measurements: name => selectRecords('measurement', 'name', name),
    frameworkRecords: operation => selectRecords('framework', 'operation', operation),
    spansNamed: name => spans.filter(span => span.name === name),
    endedSpans: () => spans.filter(span => span.endTime !== undefined),
    openSpans: () => spans.filter(span => span.endTime === undefined),

    clear(): void {
      records.length = 0
      spans.length = 0
      spansById.clear()
      overflowCount = 0
    },
    failRecords(mode: boolean | ((record: TelemetryRecord) => boolean)): void {
      recordFailure = mode === false ? null : mode === true ? () => true : mode
    },
    failTracerCreation(fail: boolean): void {
      tracerFailure = fail
    },
    setEnabledLevels(levels: readonly TelemetryLevel[] | undefined): void {
      enabledLevels = levels
    },
  }

  return provider
}
