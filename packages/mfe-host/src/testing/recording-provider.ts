/**
 * A recording telemetry provider, so asserting that a feature emits the right telemetry
 * needs no vendor SDK and no network. Every span comes from `createSpanEmitter`, the one a
 * real shell adapter uses, so this is a sink and not a second tracer.
 */

import type {
  SpanRecord,
  TelemetryEventRecord,
  TelemetryFrameworkRecord,
  TelemetryLevel,
  TelemetryLogRecord,
  TelemetryMeasurementRecord,
  TelemetryProvider,
  TelemetryRecord,
} from '@company/mfe-core'

import { createSpanEmitter } from '../telemetry/span-emitter.ts'

export interface RecordingProviderOptions {
  /** Omit for "everything". */
  readonly enabledLevels?: readonly TelemetryLevel[]
  /** Bounded buffer size for records and for spans; defaults to 1000 each. */
  readonly limit?: number
  /** Injectable clock, for deterministic tests. */
  readonly now?: () => number
}

export interface RecordingTelemetryProvider extends TelemetryProvider {
  readonly records: readonly TelemetryRecord[]
  readonly spans: readonly SpanRecord[]
  /** Entries dropped because a bounded buffer was full. */
  readonly overflowCount: number
  /** One per mount with tracing on. */
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
  /** `undefined` admits every level again. */
  setEnabledLevels(levels: readonly TelemetryLevel[] | undefined): void
}

export function createRecordingTelemetryProvider(
  options: RecordingProviderOptions = {},
): RecordingTelemetryProvider {
  const limit = options.limit ?? 1000
  const records: TelemetryRecord[] = []
  const spans: SpanRecord[] = []

  let overflowCount = 0
  let tracerCount = 0
  let enabledLevels = options.enabledLevels
  let recordFailure: ((record: TelemetryRecord) => boolean) | null = null
  let tracerFailure = false

  /** Appends to a bounded buffer, dropping the oldest entry once it is full. */
  function keep<T>(buffer: T[], entry: T): void {
    if (buffer.length >= limit) {
      buffer.shift()
      overflowCount += 1
    }
    buffer.push(entry)
  }

  /** Records of one kind, optionally narrowed by the field that names them. */
  const select = <T>(kind: string, field: string, match: string | undefined): readonly T[] =>
    records.filter(
      record =>
        record.kind === kind &&
        (match === undefined || (record as unknown as Record<string, unknown>)[field] === match),
    ) as unknown as readonly T[]

  return {
    record: record => {
      if (recordFailure !== null && recordFailure(record)) {
        throw new Error(`recording provider: record() is configured to fail for ${record.kind}`)
      }
      keep(records, record)
    },

    createTracer: attribution => {
      tracerCount += 1
      if (tracerFailure) throw new Error('recording provider: createTracer is configured to fail')
      return createSpanEmitter(attribution, {
        ...(options.now === undefined ? {} : { now: options.now }),
        onSpanStart: span => keep(spans, span),
      })
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
}
