/**
 * Provider-neutral telemetry and tracing contracts (§5.16).
 *
 * These types, constants and record shapes are framework-owned. They follow
 * OpenTelemetry's tracing conventions for the supported surface, but nothing
 * here re-exports or aliases an upstream OTel or Faro type: §5.16.2 requires
 * that author declarations and remote bundles never resolve a vendor package.
 * The shell adapter translates these records into whichever provider it uses.
 */

/** Attributes are small scalars. Bodies, credentials and raw URLs never belong here (§5.16.4). */
export type TelemetryAttributes = Readonly<Record<string, string | number | boolean>>

export type TelemetryLevel = 'debug' | 'info' | 'warn' | 'error'

export type MeasurementUnit = 'ms' | 'bytes' | 'count'

/* -------------------------------------------------------------------------- */
/* Tracing types — framework-owned, OTel-shaped                                */
/* -------------------------------------------------------------------------- */

/** Framework-owned mirror of OTel's status codes. A runtime value, not a vendor import. */
export const SpanStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const
export type SpanStatusCode = (typeof SpanStatusCode)[keyof typeof SpanStatusCode]

/** Framework-owned mirror of OTel's span kinds. */
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
  /** Epoch milliseconds. Defaults to the creation time. */
  readonly startTime?: number
}

export interface Span {
  setAttribute(key: string, value: string | number | boolean): Span
  setAttributes(attributes: TelemetryAttributes): Span
  /** A diagnostic milestone inside a span, distinct from `telemetry.event()`. */
  addEvent(name: string, attributes?: TelemetryAttributes): Span
  setStatus(status: SpanStatus): Span
  recordException(error: unknown, attributes?: TelemetryAttributes): Span
  /** Repeated calls are harmless (§5.16.2). */
  end(endTime?: number): void
  isRecording(): boolean
}

export interface Tracer {
  startSpan(name: string, options?: SpanOptions): Span
  /**
   * Runs `callback` with `span` active for context propagation. It does not end
   * the span or record a thrown exception; authors do that explicitly (§5.16.2).
   * Return types, synchronous throws and asynchronous results propagate unchanged.
   */
  startActiveSpan<T>(name: string, callback: (span: Span) => T): T
  startActiveSpan<T>(name: string, options: SpanOptions, callback: (span: Span) => T): T
}

/* -------------------------------------------------------------------------- */
/* Author surface                                                              */
/* -------------------------------------------------------------------------- */

export interface MfeTelemetry {
  /** Records a business event. */
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
  readonly tracer: Tracer
}

/* -------------------------------------------------------------------------- */
/* Normalized records — the provider integration seam                          */
/* -------------------------------------------------------------------------- */

/**
 * Attribution the host binds automatically. Authors cannot override it
 * (§5.16.3); an attribute collision resolves in favour of attribution.
 */
export interface TelemetryAttribution {
  readonly definitionId: string
  readonly definitionKind: 'app' | 'widget'
  readonly definitionVersion?: string
  readonly buildHash?: string
  /** Internal mount discriminator. Never public API (§4.2); diagnostics only. */
  readonly mountToken?: string
}

/**
 * Framework lifecycle diagnostics and author telemetry share one provider but
 * stay distinguishable (§5.16.4).
 */
export type TelemetryRecordKind = 'event' | 'log' | 'measurement' | 'framework'

export interface TelemetryEventRecord {
  readonly kind: 'event'
  readonly name: string
  readonly attributes: TelemetryAttributes
  readonly attribution: TelemetryAttribution
  readonly timestamp: number
}

export interface TelemetryLogRecord {
  readonly kind: 'log'
  readonly level: TelemetryLevel
  readonly message: string
  readonly error?: unknown
  readonly attributes: TelemetryAttributes
  readonly attribution: TelemetryAttribution
  readonly timestamp: number
}

export interface TelemetryMeasurementRecord {
  readonly kind: 'measurement'
  readonly name: string
  readonly value: number
  readonly unit: MeasurementUnit
  readonly attributes: TelemetryAttributes
  readonly attribution: TelemetryAttribution
  readonly timestamp: number
}

/** A framework lifecycle diagnostic: load, mount, validation, disposal. */
export interface TelemetryFrameworkRecord {
  readonly kind: 'framework'
  readonly level: TelemetryLevel
  readonly operation: string
  readonly message: string
  readonly error?: unknown
  readonly attributes: TelemetryAttributes
  readonly attribution: TelemetryAttribution
  readonly timestamp: number
}

export type TelemetryRecord =
  | TelemetryEventRecord
  | TelemetryLogRecord
  | TelemetryMeasurementRecord
  | TelemetryFrameworkRecord

/** Lifecycle of one span, as the provider observes it. */
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
}

/**
 * What a shell plugs in. The shell owns redaction, sampling, rate limits,
 * batching, delivery and bounded buffering (§5.16.4); this seam only hands it
 * normalized records.
 */
export interface TelemetryProvider {
  record(record: TelemetryRecord): void
  /** Creates a tracer bound to the supplied attribution. */
  createTracer(attribution: TelemetryAttribution): Tracer
  /** Called when the provider's level filter should drop a record before formatting. */
  isLevelEnabled?(level: TelemetryLevel): boolean
}

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Attribute limits (§5.16.4). Bounded counts and string lengths keep one
 * misbehaving call from filling the shell's buffer.
 */
export const TELEMETRY_LIMITS = {
  maxAttributeCount: 64,
  maxAttributeValueLength: 1024,
  maxNameLength: 256,
  /** Bounded tracking that prevents forgotten spans from growing memory (§5.16.2). */
  maxOpenSpansPerMount: 256,
} as const

/**
 * Clamps attributes to the documented limits, dropping the overflow rather than
 * truncating silently in the middle of the set. Returns the same reference when
 * nothing needed clamping, so unchanged attributes stay cheap.
 */
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
      // A non-finite attribute is dropped with the same policy as a non-finite
      // measurement: it cannot be serialized meaningfully.
      changed = true
      continue
    }
    bounded[key] = value
  }

  return changed ? Object.freeze(bounded) : attributes
}

export const EMPTY_ATTRIBUTES: TelemetryAttributes = Object.freeze({})

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
