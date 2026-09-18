/**
 * A recording telemetry provider for tests.
 *
 * It implements the whole provider seam in memory and keeps what it was given:
 * every normalized record, and the lifecycle of every span including status,
 * events, exceptions and parentage. Author tests and the framework's own tests
 * assert against it, so verifying that a feature emits the right telemetry
 * needs no monitoring account, no vendor SDK and no network.
 *
 * Parentage is rebuilt from the host-reserved `mfe.span.id` and
 * `mfe.span.parent_id` attributes the tracer writes onto each span, which is
 * also how a real shell adapter would reconstruct a tree from one record.
 *
 * The buffers are bounded like a real sink's: past the limit the oldest entries
 * are discarded and `overflowCount` moves, so a runaway test cannot exhaust
 * memory and a test can assert the overflow behaviour itself.
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

function createRecordingSpan(record: MutableSpanRecord, now: () => number): Span {
  const span: Span = {
    setAttribute(key: string, value: string | number | boolean): Span {
      record.attributes = Object.freeze({ ...record.attributes, [key]: value })
      return span
    },
    setAttributes(attributes: TelemetryAttributes): Span {
      record.attributes = Object.freeze({ ...record.attributes, ...attributes })
      return span
    },
    addEvent(name: string, attributes?: TelemetryAttributes): Span {
      record.events.push({ name, attributes: attributes ?? EMPTY_ATTRIBUTES, timestamp: now() })
      return span
    },
    setStatus(status: SpanStatus): Span {
      record.status = status
      return span
    },
    recordException(error: unknown, attributes?: TelemetryAttributes): Span {
      record.exceptions.push(error)
      // OpenTelemetry models an exception as an event on the span; mirroring
      // that keeps the attributes visible to a test.
      record.events.push({
        name: 'exception',
        attributes: attributes ?? EMPTY_ATTRIBUTES,
        timestamp: now(),
      })
      return span
    },
    end(endTime?: number): void {
      if (record.endTime === undefined) record.endTime = endTime ?? now()
    },
    isRecording(): boolean {
      return record.endTime === undefined
    },
  }
  return span
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

  function pushRecord(record: TelemetryRecord): void {
    if (records.length >= limit) {
      records.shift()
      overflowCount += 1
    }
    records.push(record)
  }

  function pushSpan(record: MutableSpanRecord): void {
    if (spans.length >= limit) {
      const evicted = spans.shift()
      overflowCount += 1
      if (evicted !== undefined) {
        const evictedId = evicted.attributes[RESERVED_ATTRIBUTE_KEYS.spanId]
        if (typeof evictedId === 'string') spansById.delete(evictedId)
      }
    }
    spans.push(record)
  }

  function createTracer(attribution: TelemetryAttribution): Tracer {
    tracerCount += 1
    if (tracerFailure) {
      throw new Error('recording provider: createTracer is configured to fail')
    }

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

      pushSpan(record)
      return createRecordingSpan(record, now)
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

  const provider: RecordingTelemetryProvider = {
    record(record: TelemetryRecord): void {
      if (recordFailure !== null && recordFailure(record)) {
        throw new Error(`recording provider: record() is configured to fail for ${record.kind}`)
      }
      pushRecord(record)
    },
    createTracer,
    isLevelEnabled(level: TelemetryLevel): boolean {
      return enabledLevels === undefined || enabledLevels.includes(level)
    },

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

    recordsOfKind<K extends TelemetryRecordKind>(
      kind: K,
    ): readonly Extract<TelemetryRecord, { kind: K }>[] {
      return records.filter(record => record.kind === kind) as Extract<
        TelemetryRecord,
        { kind: K }
      >[]
    },
    events(name?: string): readonly TelemetryEventRecord[] {
      return provider
        .recordsOfKind('event')
        .filter(record => name === undefined || record.name === name)
    },
    logs(level?: TelemetryLevel): readonly TelemetryLogRecord[] {
      return provider
        .recordsOfKind('log')
        .filter(record => level === undefined || record.level === level)
    },
    measurements(name?: string): readonly TelemetryMeasurementRecord[] {
      return provider
        .recordsOfKind('measurement')
        .filter(record => name === undefined || record.name === name)
    },
    frameworkRecords(operation?: string): readonly TelemetryFrameworkRecord[] {
      return provider
        .recordsOfKind('framework')
        .filter(record => operation === undefined || record.operation === operation)
    },
    spansNamed(name: string): readonly SpanRecord[] {
      return spans.filter(span => span.name === name)
    },
    endedSpans(): readonly SpanRecord[] {
      return spans.filter(span => span.endTime !== undefined)
    },
    openSpans(): readonly SpanRecord[] {
      return spans.filter(span => span.endTime === undefined)
    },

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
