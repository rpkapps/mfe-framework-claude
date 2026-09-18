/**
 * The mount-scoped telemetry runtime: record construction, provider
 * containment, level filtering, bounded counters and development diagnostics.
 *
 * Two rules shape everything here.
 *
 * 1. Emitting telemetry is an imperative action with no return value, no
 *    awaited I/O and no subscription. The provider is called synchronously and
 *    whatever it does with the record - batch, sample, drop, ship - is the
 *    shell's business. A provider that throws is contained here; a transport
 *    failure must never surface inside feature code.
 * 2. Failures of the telemetry path itself are counted locally, never reported
 *    through the path that failed. A diagnostics sink that throws increments a
 *    counter and nothing else, so a broken sink cannot recurse into itself.
 */

import {
  boundName,
  createMfeError,
  normalizeError,
  type Diagnostic,
  type DiagnosticSeverity,
  type DiagnosticsSink,
  type MeasurementUnit,
  type MfeErrorCode,
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

import { freezeAttribution, mergeWithReserved, reservedAttributesFor } from './attribution.ts'

/**
 * Local, bounded accounting of everything the telemetry path swallowed. These
 * are the numbers a test asserts on, and the numbers a shell can surface when
 * it suspects its provider is misbehaving. Each one is a single integer: the
 * counters themselves can never grow memory.
 */
export interface TelemetryCounters {
  /** Records handed to the provider without it throwing. */
  readonly recorded: number
  /** Calls refused because the mount was already disposed. */
  readonly droppedAfterDispose: number
  /** Records the provider's level filter rejected. */
  readonly droppedByLevelFilter: number
  /** `measure()` calls carrying a non-finite value. */
  readonly invalidMeasurements: number
  /** Framework reports suppressed because the same error was already reported. */
  readonly deduplicatedErrors: number
  /** Repeat reports of an error instance the mount had already recorded. */
  readonly duplicateErrorReports: number
  /** Attribute keys that tried to shadow host-bound attribution. */
  readonly reservedOverrideAttempts: number
  /** Throws contained from the provider, its tracer, its spans or a diagnostics sink. */
  readonly sinkFailures: number
  readonly spansStarted: number
  /** Span creations refused because the open-span budget was exhausted. */
  readonly spansDroppedAtLimit: number
  /** Spans still open at disposal, finalized as cancelled. */
  readonly spansFinalizedAtDisposal: number
  /** Mutations attempted on an already ended span. */
  readonly mutationsAfterEnd: number
  readonly diagnosticsEmitted: number
  /** Diagnostics withheld after the per-mount diagnostic budget ran out. */
  readonly diagnosticsSuppressed: number
}

class MutableCounters {
  recorded = 0
  droppedAfterDispose = 0
  droppedByLevelFilter = 0
  invalidMeasurements = 0
  deduplicatedErrors = 0
  duplicateErrorReports = 0
  reservedOverrideAttempts = 0
  sinkFailures = 0
  spansStarted = 0
  spansDroppedAtLimit = 0
  spansFinalizedAtDisposal = 0
  mutationsAfterEnd = 0
  diagnosticsEmitted = 0
  diagnosticsSuppressed = 0

  snapshot(): TelemetryCounters {
    return Object.freeze({
      recorded: this.recorded,
      droppedAfterDispose: this.droppedAfterDispose,
      droppedByLevelFilter: this.droppedByLevelFilter,
      invalidMeasurements: this.invalidMeasurements,
      deduplicatedErrors: this.deduplicatedErrors,
      duplicateErrorReports: this.duplicateErrorReports,
      reservedOverrideAttempts: this.reservedOverrideAttempts,
      sinkFailures: this.sinkFailures,
      spansStarted: this.spansStarted,
      spansDroppedAtLimit: this.spansDroppedAtLimit,
      spansFinalizedAtDisposal: this.spansFinalizedAtDisposal,
      mutationsAfterEnd: this.mutationsAfterEnd,
      diagnosticsEmitted: this.diagnosticsEmitted,
      diagnosticsSuppressed: this.diagnosticsSuppressed,
    })
  }
}

export interface DiagnosticDetails {
  readonly code: MfeErrorCode
  readonly operation: string
  readonly expected?: string
  readonly observed?: string
  readonly repair?: string
  readonly note?: string
  readonly severity?: DiagnosticSeverity
  readonly context?: Readonly<Record<string, string | number | boolean>>
}

export interface TelemetryRuntimeOptions {
  /** Where development diagnostics go. The host wires this to its diagnostics hub. */
  readonly onDiagnostic?: DiagnosticsSink
  /** Defaults to "not a production build". Diagnostics are silent when false. */
  readonly dev?: boolean
  /** Per-mount diagnostic budget; beyond it only the counters move. */
  readonly maxDiagnostics?: number
  /** Injectable clock, for deterministic tests. */
  readonly now?: () => number
}

const DEFAULT_MAX_DIAGNOSTICS = 50

function detectDevelopmentMode(): boolean {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } }
  const mode = runtime.process?.env?.['NODE_ENV']
  return mode !== 'production'
}

/**
 * Everything the telemetry service and the tracer share for one mount.
 *
 * `owner` is the identity the context manager compares, so it must be created
 * once per mount and never handed out.
 */
export class MountTelemetryRuntime {
  readonly provider: TelemetryProvider
  readonly attribution: TelemetryAttribution
  readonly reservedAttributes: TelemetryAttributes
  readonly owner: object = Object.freeze({})
  readonly counters = new MutableCounters()

  readonly #onDiagnostic: DiagnosticsSink | undefined
  readonly #dev: boolean
  readonly #maxDiagnostics: number
  readonly #clock: () => number
  /**
   * Error identities this mount already reported. Weak, so it cannot keep an
   * error - or its closure over a whole component tree - alive.
   */
  readonly #reportedErrors = new WeakSet<object>()
  #disposed = false

  constructor(
    provider: TelemetryProvider,
    attribution: TelemetryAttribution,
    options: TelemetryRuntimeOptions = {},
  ) {
    this.provider = provider
    this.attribution = freezeAttribution(attribution)
    this.reservedAttributes = reservedAttributesFor(this.attribution)
    this.#onDiagnostic = options.onDiagnostic
    this.#dev = options.dev ?? detectDevelopmentMode()
    this.#maxDiagnostics = options.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS
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

  /* ---------------------------------------------------------------------- */
  /* Containment                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Calls into the provider and swallows its failure into a counter plus a
   * development diagnostic. The diagnostics sink is a different sink from the
   * telemetry provider, so reporting a provider failure there is not recursive;
   * a diagnostics sink failure, by contrast, is only ever counted.
   */
  safeProviderCall<T>(operation: string, call: () => T): T | undefined {
    try {
      return call()
    } catch (failure) {
      this.counters.sinkFailures += 1
      this.diagnose({
        code: 'config/invalid',
        operation,
        expected: 'a telemetry provider that returns without throwing',
        observed: `the provider threw ${normalizeError(failure).name}`,
        repair:
          'Fix the provider so it buffers or drops internally. The record was discarded and the mount continued.',
        severity: 'warning',
      })
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

    const error = createMfeError({
      code: details.code,
      id: this.attribution.definitionId,
      operation: details.operation,
      ...(this.attribution.definitionVersion === undefined
        ? {}
        : { definitionVersion: this.attribution.definitionVersion }),
      ...(details.expected === undefined ? {} : { expected: details.expected }),
      ...(details.observed === undefined ? {} : { observed: details.observed }),
      declaredBy: 'The host telemetry binding',
      ...(details.repair === undefined ? {} : { repair: details.repair }),
      ...(details.note === undefined ? {} : { note: details.note }),
    })

    const diagnostic: Diagnostic = {
      severity: details.severity ?? 'warning',
      error,
      ...(details.context === undefined ? {} : { context: details.context }),
      timestamp: this.now(),
    }

    try {
      sink(diagnostic)
    } catch {
      // Counted, never re-reported: a failing diagnostics sink that reported its
      // own failure would recurse forever.
      this.counters.sinkFailures += 1
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Attributes                                                              */
  /* ---------------------------------------------------------------------- */

  /** Clamps author attributes and lets host-bound attribution win collisions. */
  mergeAttributes(author: TelemetryAttributes | undefined, operation: string): TelemetryAttributes {
    const merged = mergeWithReserved(author, this.reservedAttributes)
    if (merged.collisions.length > 0) {
      this.counters.reservedOverrideAttempts += merged.collisions.length
      this.diagnose({
        code: 'contract/input-mismatch',
        operation,
        expected: 'attribute keys outside the host-owned "mfe." attribution namespace',
        observed: `reserved ${merged.collisions.length === 1 ? 'key' : 'keys'} ${merged.collisions.join(', ')}`,
        repair:
          'Rename the attribute. Host-bound attribution always wins, so the supplied value was discarded.',
      })
    }
    return merged.attributes
  }

  /* ---------------------------------------------------------------------- */
  /* Emission                                                                */
  /* ---------------------------------------------------------------------- */

  /** True when the call must be refused because the mount is gone. */
  #refuseAfterDispose(operation: string): boolean {
    if (!this.#disposed) return false
    this.counters.droppedAfterDispose += 1
    this.diagnose({
      code: 'dispose/failure',
      operation,
      expected: 'telemetry only while the mount is live',
      observed: 'a telemetry call arrived after the mount was disposed',
      repair:
        'Cancel the work that produced it with the mount abort signal. The record was dropped; records emitted before disposal keep their attribution.',
    })
    return true
  }

  #levelEnabled(level: TelemetryLevel): boolean {
    const provider = this.provider
    if (typeof provider.isLevelEnabled !== 'function') return true
    try {
      return provider.isLevelEnabled(level) !== false
    } catch {
      // A filter that throws must not lose the record: count the failure and
      // let the record through, where the provider can still drop it.
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

  emitEvent(name: string, attributes: TelemetryAttributes | undefined): void {
    const operation = 'record a telemetry event'
    if (this.#refuseAfterDispose(operation)) return
    const record: TelemetryEventRecord = {
      kind: 'event',
      name: boundName(name),
      attributes: this.mergeAttributes(attributes, operation),
      attribution: this.attribution,
      timestamp: this.now(),
    }
    this.#deliver(record, operation)
  }

  emitLog(
    level: TelemetryLevel,
    message: string,
    attributes: TelemetryAttributes | undefined,
    error?: unknown,
  ): void {
    const operation = `record a ${level} log`
    if (this.#refuseAfterDispose(operation)) return
    // The shell owns level filtering, including whether debug is collected at
    // all; the binding only asks.
    if (!this.#levelEnabled(level)) {
      this.counters.droppedByLevelFilter += 1
      return
    }
    const record: TelemetryLogRecord = {
      kind: 'log',
      level,
      message: boundName(message),
      ...(error === undefined ? {} : { error }),
      attributes: this.mergeAttributes(attributes, operation),
      attribution: this.attribution,
      timestamp: this.now(),
    }
    this.#deliver(record, operation)
  }

  emitError(error: unknown, attributes: TelemetryAttributes | undefined): void {
    const normalized = normalizeError(error)
    if (typeof error === 'object' && error !== null) {
      if (this.#reportedErrors.has(error)) this.counters.duplicateErrorReports += 1
      else this.#reportedErrors.add(error)
    }
    // "error.type" is a convenience, not attribution: an author who supplies it
    // deliberately wins, while the reserved namespace still cannot be shadowed.
    const merged: TelemetryAttributes = { 'error.type': normalized.name, ...(attributes ?? {}) }
    this.emitLog('error', normalized.message, merged, error)
  }

  emitMeasurement(
    name: string,
    value: number,
    unit: MeasurementUnit,
    attributes: TelemetryAttributes | undefined,
  ): void {
    const operation = 'record a measurement'
    if (this.#refuseAfterDispose(operation)) return
    if (!Number.isFinite(value)) {
      // One finite observation with a unit, or nothing: NaN and the infinities
      // cannot be aggregated and would poison a histogram downstream.
      this.counters.invalidMeasurements += 1
      this.diagnose({
        code: 'contract/input-mismatch',
        operation,
        expected: 'a finite number',
        observed: `${String(value)} for measurement "${boundName(name)}"`,
        repair: 'Guard the computation before measuring. The observation was not recorded.',
      })
      return
    }
    const record: TelemetryMeasurementRecord = {
      kind: 'measurement',
      name: boundName(name),
      value,
      unit,
      attributes: this.mergeAttributes(attributes, operation),
      attribution: this.attribution,
      timestamp: this.now(),
    }
    this.#deliver(record, operation)
  }

  /**
   * A framework lifecycle diagnostic. Deduplicated against errors the mount has
   * already reported, so an author who reported a failure and a framework stage
   * that observed the same instance do not produce two records of one event.
   */
  emitFramework(
    operation: string,
    details: {
      readonly level?: TelemetryLevel
      readonly message: string
      readonly error?: unknown
      readonly attributes?: TelemetryAttributes
    },
  ): void {
    const label = `record a framework diagnostic for ${operation}`
    if (this.#refuseAfterDispose(label)) return

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

    const record: TelemetryFrameworkRecord = {
      kind: 'framework',
      level,
      operation: boundName(operation),
      message: boundName(details.message),
      ...(error === undefined ? {} : { error }),
      attributes: this.mergeAttributes(details.attributes, label),
      attribution: this.attribution,
      timestamp: this.now(),
    }
    this.#deliver(record, label)
  }
}
