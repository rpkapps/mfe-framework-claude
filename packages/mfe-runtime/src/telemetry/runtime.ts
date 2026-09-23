/**
 * The mount-scoped telemetry runtime. A failure of the telemetry path is only ever counted,
 * never reported back through the path that failed, and every `diagnose` call site is
 * wrapped in `if (DEV)` so a production build drops the prose rather than skipping it.
 */

import {
  boundAttributes,
  boundName,
  createMfeError,
  DEV,
  normalizeError,
  withoutUndefined,
  type Diagnostic,
  type DiagnosticsSink,
  type MeasurementUnit,
  type MfeErrorCode,
  type TelemetryAttributes,
  type TelemetryAttribution,
  type TelemetryLevel,
  type TelemetryProvider,
  type TelemetryRecord,
} from '@company/mfe-core'

/**
 * The `mfe.*` namespace the host owns; span ids live here because an author who set them
 * by hand would silently corrupt the trace.
 */
export const RESERVED_ATTRIBUTE_KEYS = {
  definitionId: 'mfe.definition.id',
  definitionKind: 'mfe.definition.kind',
  definitionVersion: 'mfe.definition.version',
  buildHash: 'mfe.build.hash',
  mountToken: 'mfe.mount.token',
  traceId: 'mfe.trace.id',
  spanId: 'mfe.span.id',
  parentSpanId: 'mfe.span.parent_id',
  cancelled: 'mfe.span.cancelled',
  endReason: 'mfe.span.end_reason',
} as const

export type ReservedAttributeKey =
  (typeof RESERVED_ATTRIBUTE_KEYS)[keyof typeof RESERVED_ATTRIBUTE_KEYS]

const RESERVED_KEYS: ReadonlySet<string> = new Set<string>(Object.values(RESERVED_ATTRIBUTE_KEYS))

export function isReservedAttributeKey(key: string): boolean {
  return RESERVED_KEYS.has(key)
}

/** The attribution fields, in the order they are bound onto every record. */
const ATTRIBUTION_FIELDS = [
  'definitionId',
  'definitionKind',
  'definitionVersion',
  'buildHash',
  'mountToken',
] as const satisfies readonly (keyof TelemetryAttribution)[]

/**
 * Local accounting of everything the telemetry path swallowed; each is a single integer, so the
 * counters can never grow memory.
 */
export interface TelemetryCounters {
  readonly recorded: number
  readonly droppedAfterDispose: number
  readonly droppedByLevelFilter: number
  readonly invalidMeasurements: number
  /** A framework report suppressed because the same error was already reported. */
  readonly deduplicatedErrors: number
  /** A repeat report of an error instance the mount had already recorded. */
  readonly duplicateErrorReports: number
  /** Attribute keys that tried to shadow host-bound attribution. */
  readonly reservedOverrideAttempts: number
  /** Throws contained from the provider, its tracer, its spans or a sink. */
  readonly sinkFailures: number
  readonly spansStarted: number
  readonly spansDroppedAtLimit: number
  readonly spansFinalizedAtDisposal: number
  readonly mutationsAfterEnd: number
  readonly diagnosticsEmitted: number
  readonly diagnosticsSuppressed: number
}

type MutableCounters = { -readonly [K in keyof TelemetryCounters]: number }

function newCounters(): MutableCounters {
  return {
    recorded: 0,
    droppedAfterDispose: 0,
    droppedByLevelFilter: 0,
    invalidMeasurements: 0,
    deduplicatedErrors: 0,
    duplicateErrorReports: 0,
    reservedOverrideAttempts: 0,
    sinkFailures: 0,
    spansStarted: 0,
    spansDroppedAtLimit: 0,
    spansFinalizedAtDisposal: 0,
    mutationsAfterEnd: 0,
    diagnosticsEmitted: 0,
    diagnosticsSuppressed: 0,
  }
}

export interface DiagnosticDetails {
  readonly code: MfeErrorCode
  readonly operation: string
  readonly expected?: string
  readonly observed?: string
  readonly repair?: string
  readonly context?: Readonly<Record<string, string | number | boolean>>
}

export interface FrameworkRecordDetails {
  /** Defaults to `info`. */
  readonly level?: TelemetryLevel
  readonly message: string
  readonly error?: unknown
  readonly attributes?: TelemetryAttributes
}

export interface TelemetryRuntimeOptions {
  /** The host wires this to its diagnostics hub. */
  readonly onDiagnostic?: DiagnosticsSink
  /** Defaults to "not a production build"; diagnostics are silent when false. */
  readonly dev?: boolean
  /** Per-mount diagnostic budget; beyond it only the counters move. */
  readonly maxDiagnostics?: number
  /** Injectable clock, for deterministic tests. */
  readonly now?: () => number
}

/** Everything the telemetry service and the tracer share for one mount. */
export class MountTelemetryRuntime {
  readonly provider: TelemetryProvider
  readonly attribution: TelemetryAttribution
  /** Identity the context manager compares, created per mount and never handed out. */
  readonly owner: object = Object.freeze({})
  readonly counters: MutableCounters = newCounters()

  readonly #reserved: TelemetryAttributes
  readonly #onDiagnostic: DiagnosticsSink | undefined
  readonly #dev: boolean
  readonly #maxDiagnostics: number
  readonly #clock: () => number
  /** Weak, so it cannot keep an error — or its closure over a tree — alive. */
  readonly #reportedErrors = new WeakSet<object>()
  #disposed = false

  constructor(
    provider: TelemetryProvider,
    attribution: TelemetryAttribution,
    options: TelemetryRuntimeOptions = {},
  ) {
    // Copied field by field, so a record keeps the attribution it carried even if the
    // caller mutates its own object later.
    const bound: Record<string, string> = {}
    const reserved: Record<string, string> = {}
    for (const field of ATTRIBUTION_FIELDS) {
      const value = attribution[field]
      if (value === undefined) continue
      bound[field] = value
      reserved[RESERVED_ATTRIBUTE_KEYS[field]] = value
    }
    this.provider = provider
    this.attribution = Object.freeze(bound) as unknown as TelemetryAttribution
    this.#reserved = Object.freeze(reserved)
    this.#onDiagnostic = options.onDiagnostic
    this.#dev = options.dev ?? DEV
    this.#maxDiagnostics = options.maxDiagnostics ?? 50
    this.#clock = options.now ?? Date.now
  }

  get disposed(): boolean {
    return this.#disposed
  }

  now(): number {
    return this.#clock()
  }

  markDisposed(): void {
    this.#disposed = true
  }

  counterSnapshot(): TelemetryCounters {
    return Object.freeze({ ...this.counters })
  }

  /**
   * The diagnostics sink is a different sink, so reporting a provider failure there is not
   * recursive.
   */
  safeProviderCall<T>(operation: string, call: () => T): T | undefined {
    try {
      return call()
    } catch (failure) {
      this.counters.sinkFailures += 1
      if (DEV) {
        this.diagnose({
          code: 'config/invalid',
          operation,
          expected: 'a telemetry provider that returns without throwing',
          observed: `the provider threw ${normalizeError(failure).name}`,
          repair: 'Fix the provider so it buffers or drops internally.',
        })
      }
      return undefined
    }
  }

  /** Development-only diagnostic, bounded per mount and never self-reporting. */
  diagnose(details: DiagnosticDetails): void {
    if (!this.#dev) return
    if (this.counters.diagnosticsEmitted >= this.#maxDiagnostics) {
      this.counters.diagnosticsSuppressed += 1
      return
    }
    this.counters.diagnosticsEmitted += 1

    const sink = this.#onDiagnostic
    if (sink === undefined) return

    const { context, ...message } = details
    const version = this.attribution.definitionVersion
    const diagnostic: Diagnostic = {
      severity: 'warning',
      error: createMfeError({
        ...message,
        id: this.attribution.definitionId,
        ...withoutUndefined({ definitionVersion: version }),
      }),
      ...withoutUndefined({ context }),
      timestamp: this.now(),
    }

    try {
      sink(diagnostic)
    } catch {
      // Counted, never re-reported: a sink that reported its own failure would recurse
      // forever.
      this.counters.sinkFailures += 1
    }
  }

  /**
   * Host-bound attribution wins, so a forged reserved key is dropped rather than passed
   * through looking like attribution.
   */
  mergeAttributes(author: TelemetryAttributes | undefined, operation: string): TelemetryAttributes {
    const bounded = boundAttributes(author)
    const keys = Object.keys(bounded)
    if (keys.length === 0) return this.#reserved

    const collisions: string[] = []
    const authored: Record<string, string | number | boolean> = {}
    for (const key of keys) {
      const value = bounded[key]
      if (RESERVED_KEYS.has(key)) collisions.push(key)
      else if (value !== undefined) authored[key] = value
    }

    if (collisions.length > 0) {
      this.counters.reservedOverrideAttempts += collisions.length
      if (DEV) {
        this.diagnose({
          code: 'contract/input-mismatch',
          operation,
          expected: 'attribute keys outside the host-owned "mfe." attribution namespace',
          observed: `reserved ${collisions.length === 1 ? 'key' : 'keys'} ${collisions.join(', ')}`,
          repair: 'Rename the attribute; the supplied value was discarded.',
        })
      }
    }
    return Object.freeze({ ...authored, ...this.#reserved })
  }

  /** True when the call must be refused because the mount is gone. */
  #refused(operation: string): boolean {
    if (!this.#disposed) return false
    this.counters.droppedAfterDispose += 1
    if (DEV) {
      this.diagnose({
        code: 'dispose/failure',
        operation,
        expected: 'telemetry only while the mount is live',
        observed: 'a telemetry call arrived after the mount was disposed',
        repair: 'Cancel the work that produced it with the mount abort signal.',
      })
    }
    return true
  }

  /** The shell owns level filtering, including whether debug is collected. */
  #levelEnabled(level: TelemetryLevel): boolean {
    const { provider } = this
    if (typeof provider.isLevelEnabled !== 'function') return true
    try {
      return provider.isLevelEnabled(level) !== false
    } catch {
      // A filter that throws must not lose the record, which the provider can still
      // drop itself.
      this.counters.sinkFailures += 1
      return true
    }
  }

  #deliver(record: TelemetryRecord, operation: string): void {
    const delivered = this.safeProviderCall(operation, () => {
      this.provider.record(record)
      return true
    })
    if (delivered === true) this.counters.recorded += 1
  }

  /** The fields every record shares. */
  #envelope(
    attributes: TelemetryAttributes | undefined,
    operation: string,
  ): Pick<TelemetryRecord, 'attributes' | 'attribution' | 'timestamp'> {
    return {
      attributes: this.mergeAttributes(attributes, operation),
      attribution: this.attribution,
      timestamp: this.now(),
    }
  }

  emitEvent(name: string, attributes: TelemetryAttributes | undefined): void {
    const operation = 'record a telemetry event'
    if (this.#refused(operation)) return
    this.#deliver(
      { kind: 'event', name: boundName(name), ...this.#envelope(attributes, operation) },
      operation,
    )
  }

  emitLog(
    level: TelemetryLevel,
    message: string,
    attributes: TelemetryAttributes | undefined,
    error?: unknown,
  ): void {
    const operation = `record a ${level} log`
    if (this.#refused(operation)) return
    if (!this.#levelEnabled(level)) {
      this.counters.droppedByLevelFilter += 1
      return
    }
    this.#deliver(
      {
        kind: 'log',
        level,
        message: boundName(message),
        ...withoutUndefined({ error }),
        ...this.#envelope(attributes, operation),
      },
      operation,
    )
  }

  emitError(error: unknown, attributes: TelemetryAttributes | undefined): void {
    const normalized = normalizeError(error)
    if (typeof error === 'object' && error !== null) {
      if (this.#reportedErrors.has(error)) this.counters.duplicateErrorReports += 1
      else this.#reportedErrors.add(error)
    }
    // "error.type" is a convenience, not attribution, so an author who supplies it wins.
    const merged = { 'error.type': normalized.name, ...(attributes ?? {}) }
    this.emitLog('error', normalized.message, merged, error)
  }

  emitMeasurement(
    name: string,
    value: number,
    unit: MeasurementUnit,
    attributes: TelemetryAttributes | undefined,
  ): void {
    const operation = 'record a measurement'
    if (this.#refused(operation)) return
    if (!Number.isFinite(value)) {
      // NaN and the infinities would poison a histogram downstream, so nothing is
      // recorded at all.
      this.counters.invalidMeasurements += 1
      if (DEV) {
        this.diagnose({
          code: 'contract/input-mismatch',
          operation,
          expected: 'a finite number',
          observed: `${String(value)} for measurement "${boundName(name)}"`,
          repair: 'Guard the computation before measuring; nothing was recorded.',
        })
      }
      return
    }
    this.#deliver(
      {
        kind: 'measurement',
        name: boundName(name),
        value,
        unit,
        ...this.#envelope(attributes, operation),
      },
      operation,
    )
  }

  /**
   * Deduplicated against errors the mount has already reported, so one failure never produces two
   * records.
   */
  emitFramework(operation: string, details: FrameworkRecordDetails): void {
    const label = `record a framework diagnostic for ${operation}`
    if (this.#refused(label)) return

    const level = details.level ?? 'info'
    if (!this.#levelEnabled(level)) {
      this.counters.droppedByLevelFilter += 1
      return
    }

    const error = details.error
    if (typeof error === 'object' && error !== null) {
      if (this.#reportedErrors.has(error)) {
        this.counters.deduplicatedErrors += 1
        return
      }
      this.#reportedErrors.add(error)
    }

    this.#deliver(
      {
        kind: 'framework',
        level,
        operation: boundName(operation),
        message: boundName(details.message),
        ...withoutUndefined({ error }),
        ...this.#envelope(details.attributes, label),
      },
      label,
    )
  }
}
