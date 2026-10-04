/** OTel-shaped but vendor-free, because a remote bundle must never resolve a vendor package. */

/** Small scalars only; bodies, credentials and raw URLs never belong here. */
export type TelemetryAttributes = Readonly<Record<string, string | number | boolean>>

export type TelemetryLevel = 'debug' | 'info' | 'warn' | 'error'

export type MeasurementUnit = 'ms' | 'bytes' | 'count'

/** A runtime value, not a vendor import. */
export const SpanStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const
export type SpanStatusCode = (typeof SpanStatusCode)[keyof typeof SpanStatusCode]

export const SpanKind = {
  INTERNAL: 0,
  SERVER: 1,
  CLIENT: 2,
  PRODUCER: 3,
  CONSUMER: 4,
} as const
export type SpanKind = (typeof SpanKind)[keyof typeof SpanKind]

export interface SpanStatus {
  readonly code: SpanStatusCode
  readonly message?: string
}

export interface SpanOptions {
  readonly kind?: SpanKind
  readonly attributes?: TelemetryAttributes
  /** Epoch milliseconds; defaults to the creation time. */
  readonly startTime?: number
}

export interface Span {
  setAttribute(key: string, value: string | number | boolean): Span
  setAttributes(attributes: TelemetryAttributes): Span
  /** A diagnostic milestone inside a span, distinct from `telemetry.event()`. */
  addEvent(name: string, attributes?: TelemetryAttributes): Span
  setStatus(status: SpanStatus): Span
  recordException(error: unknown, attributes?: TelemetryAttributes): Span
  /** Repeated calls are harmless. */
  end(endTime?: number): void
  isRecording(): boolean
}

/** What a provider builds for one mount; only the mount's workflows start spans on it. */
export interface Tracer {
  startSpan(name: string, options?: SpanOptions): Span
}

/**
 * One named piece of user-facing work, such as a checkout, traced from its start to its end. It is
 * one trace: each step is a child of the workflow, and a request joins it only through `headers()`.
 * The run is the page's: every App and Widget that names it, with the same key, acts on the same
 * run, and each takes part in it from its first call while it is open. Spans and records are
 * attributed to the mount that made them. Its record methods emit what the same `MfeTelemetry`
 * method would, linked to the current step, or the workflow before its first step, while open;
 * otherwise, or when the run has no spans, unlinked.
 */
export interface Workflow {
  /** Starts the run, or joins the open one and adds these attributes to it. */
  start(attributes?: TelemetryAttributes): void
  /**
   * Marks the next step, ending the current one whichever mount marked it. A step lasts until the
   * next step or the end. Ignored when not open.
   */
  step(name: string, attributes?: TelemetryAttributes): void
  /**
   * `{ traceparent }` for the current step, or the workflow before its first step, while open; `{}`
   * otherwise or when the run has no spans. Spread it into a request's headers.
   */
  headers(): Record<string, string>
  /** Ends it as succeeded for every mount in it. Ignored when not open. */
  succeed(attributes?: TelemetryAttributes): void
  /**
   * Ends it as failed with this error, for every mount in it; the error is also reported. Ignored
   * when not open, except that the error is still reported.
   */
  fail(error: unknown, attributes?: TelemetryAttributes): void
  event(name: string, attributes?: TelemetryAttributes): void
  debug(message: string, attributes?: TelemetryAttributes): void
  info(message: string, attributes?: TelemetryAttributes): void
  warn(message: string, attributes?: TelemetryAttributes): void
  /** Reports an error without ending the workflow; `fail` ends it. */
  error(error: unknown, attributes?: TelemetryAttributes): void
  measure(
    name: string,
    value: number,
    options: { unit: MeasurementUnit; attributes?: TelemetryAttributes },
  ): void
}

/** The author-facing surface. */
export interface MfeTelemetry {
  event(name: string, attributes?: TelemetryAttributes): void
  debug(message: string, attributes?: TelemetryAttributes): void
  info(message: string, attributes?: TelemetryAttributes): void
  warn(message: string, attributes?: TelemetryAttributes): void
  /** Reports an error without throwing or handling it. */
  error(error: unknown, attributes?: TelemetryAttributes): void
  /** One finite numeric observation with a unit — not a counter or a gauge. */
  measure(
    name: string,
    value: number,
    options: { unit: MeasurementUnit; attributes?: TelemetryAttributes },
  ): void
  /**
   * The workflow with this name and key; the same object every call with the same pair, and the
   * same run as every other mount on the page that uses the pair. A key, such as an upload's id,
   * lets several runs of one name be open at once. It only picks the run and is never recorded.
   */
  workflow(name: string, key?: string): Workflow
}

/** W3C trace context ids, hex-encoded: 32 characters for the trace, 16 for the span. */
export interface TelemetrySpanContext {
  readonly traceId: string
  readonly spanId: string
}

/** Authors cannot override it: an attribute collision resolves in favour of attribution. */
export interface TelemetryAttribution {
  readonly definitionId: string
  readonly definitionKind: 'app' | 'widget'
  readonly definitionVersion?: string
  readonly buildHash?: string
  /** Internal mount discriminator; never public API. */
  readonly mountToken?: string
}

/** Framework lifecycle diagnostics and author telemetry share one provider but stay apart. */
export type TelemetryRecordKind = 'event' | 'log' | 'measurement' | 'framework'

export interface TelemetryEventRecord {
  readonly kind: 'event'
  readonly name: string
  readonly attributes: TelemetryAttributes
  readonly attribution: TelemetryAttribution
  readonly timestamp: number
  /** The span the record belongs to, so a backend can link the two. */
  readonly spanContext?: TelemetrySpanContext
}

export interface TelemetryLogRecord {
  readonly kind: 'log'
  readonly level: TelemetryLevel
  readonly message: string
  readonly error?: unknown
  readonly attributes: TelemetryAttributes
  readonly attribution: TelemetryAttribution
  readonly timestamp: number
  /** The span the record belongs to, so a backend can link the two. */
  readonly spanContext?: TelemetrySpanContext
}

export interface TelemetryMeasurementRecord {
  readonly kind: 'measurement'
  readonly name: string
  readonly value: number
  readonly unit: MeasurementUnit
  readonly attributes: TelemetryAttributes
  readonly attribution: TelemetryAttribution
  readonly timestamp: number
  /** The span the record belongs to, so a backend can link the two. */
  readonly spanContext?: TelemetrySpanContext
}

export interface TelemetryFrameworkRecord {
  readonly kind: 'framework'
  readonly level: TelemetryLevel
  readonly operation: string
  readonly message: string
  readonly error?: unknown
  readonly attributes: TelemetryAttributes
  readonly attribution: TelemetryAttribution
  readonly timestamp: number
  /** The span the record belongs to, so a backend can link the two. */
  readonly spanContext?: TelemetrySpanContext
}

export type TelemetryRecord =
  TelemetryEventRecord | TelemetryLogRecord | TelemetryMeasurementRecord | TelemetryFrameworkRecord

export interface SpanRecord {
  readonly name: string
  readonly kind: SpanKind
  readonly attributes: TelemetryAttributes
  readonly attribution: TelemetryAttribution
  readonly startTime: number
  readonly endTime?: number
  readonly status: SpanStatus
  readonly events: readonly { name: string; attributes: TelemetryAttributes; timestamp: number }[]
  readonly exceptions: readonly unknown[]
  readonly parent?: SpanRecord
  /** The span's own ids; absent only for a span started outside a mount's tracer. */
  readonly spanContext?: TelemetrySpanContext
  /** Set even when the parent record is not available, as for a parent in an ended batch. */
  readonly parentSpanId?: string
}

/** The shell owns redaction, sampling, batching and delivery; this seam only normalizes records. */
export interface TelemetryProvider {
  record(record: TelemetryRecord): void
  createTracer(attribution: TelemetryAttribution): Tracer
  /** Lets a provider drop a record before it is formatted. */
  isLevelEnabled?(level: TelemetryLevel): boolean
}

/** Bounds that keep one misbehaving call from filling the shell's buffer. */
export const TELEMETRY_LIMITS = {
  maxAttributeCount: 64,
  maxAttributeValueLength: 1024,
  maxNameLength: 256,
  maxOpenSpansPerMount: 256,
} as const

export const EMPTY_ATTRIBUTES: TelemetryAttributes = Object.freeze({})

/** Returns the same reference when nothing needed clamping. */
export function boundAttributes(attributes: TelemetryAttributes | undefined): TelemetryAttributes {
  if (!attributes) return EMPTY_ATTRIBUTES

  const entries = Object.entries(attributes)
  if (entries.length === 0) return EMPTY_ATTRIBUTES

  let changed = entries.length > TELEMETRY_LIMITS.maxAttributeCount
  const bounded: Record<string, string | number | boolean> = {}

  for (const [key, value] of entries.slice(0, TELEMETRY_LIMITS.maxAttributeCount)) {
    if (typeof value === 'string' && value.length > TELEMETRY_LIMITS.maxAttributeValueLength) {
      bounded[key] = value.slice(0, TELEMETRY_LIMITS.maxAttributeValueLength)
      changed = true
      continue
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      // A non-finite number cannot be serialized meaningfully, as for a measurement.
      changed = true
      continue
    }
    bounded[key] = value
  }

  return changed ? Object.freeze(bounded) : attributes
}

export function boundName(name: string): string {
  return name.length > TELEMETRY_LIMITS.maxNameLength
    ? name.slice(0, TELEMETRY_LIMITS.maxNameLength)
    : name
}

/** Normalizes a thrown value for a record without dumping a whole payload. */
export function normalizeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    }
  }
  return { name: 'NonError', message: typeof error === 'string' ? error : String(error) }
}
