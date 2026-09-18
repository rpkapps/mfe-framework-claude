/**
 * The mount-scoped telemetry runtime: record construction, provider
 * containment, level filtering, bounded counters and development diagnostics.
 *
 * Emitting is synchronous and returns nothing, so it can never rerender. A
 * provider that throws is contained here, and a failure of the telemetry path
 * is only ever counted — never reported back through the path that failed.
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

import { bindAttribution, mergeWithReserved } from './attribution.ts'

const COUNTER_NAMES = [
  'recorded',
  'droppedAfterDispose',
  'droppedByLevelFilter',
  'invalidMeasurements',
  // A framework report suppressed because the same error was already reported.
  'deduplicatedErrors',
  // A repeat report of an error instance the mount had already recorded.
  'duplicateErrorReports',
  // Attribute keys that tried to shadow host-bound attribution.
  'reservedOverrideAttempts',
  // Throws contained from the provider, its tracer, its spans or a sink.
  'sinkFailures',
  'spansStarted',
  'spansDroppedAtLimit',
  'spansFinalizedAtDisposal',
  'mutationsAfterEnd',
  'diagnosticsEmitted',
  'diagnosticsSuppressed',
] as const

/**
 * Local, bounded accounting of everything the telemetry path swallowed: the
 * numbers a shell can surface when it suspects its provider is misbehaving.
 * Each one is a single integer, so the counters can never grow memory.
 */
export type TelemetryCounters = Readonly<Record<(typeof COUNTER_NAMES)[number], number>>

type MutableCounters = { -readonly [K in keyof TelemetryCounters]: number }

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
  return runtime.process?.env?.['NODE_ENV'] !== 'production'
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
  readonly counters: MutableCounters = Object.fromEntries(
    COUNTER_NAMES.map(name => [name, 0]),
  ) as MutableCounters

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
    const bound = bindAttribution(attribution)
    this.provider = provider
    this.attribution = bound.attribution
    this.reservedAttributes = bound.attributes
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

  counterSnapshot(): TelemetryCounters {
    return Object.freeze({ ...this.counters })
  }

  /**
   * Calls into the provider and swallows its failure into a counter plus a
   * diagnostic. The diagnostics sink is a different sink, so reporting a
   * provider failure there is not recursive.
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
        repair: 'Fix the provider so it buffers or drops internally.',
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

    const diagnostic: Diagnostic = {
      severity: details.severity ?? 'warning',
      error: createMfeError({
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
      }),
      ...(details.context === undefined ? {} : { context: details.context }),
      timestamp: this.now(),
    }

    try {
      sink(diagnostic)
    } catch {
      // Counted, never re-reported: a failing sink that reported its own
      // failure would recurse forever.
      this.counters.sinkFailures += 1
    }
  }

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
        repair: 'Rename the attribute; the supplied value was discarded.',
      })
    }
    return merged.attributes
  }

  /** True when the call must be refused because the mount is gone. */
  #refuseAfterDispose(operation: string): boolean {
    if (!this.#disposed) return false
    this.counters.droppedAfterDispose += 1
    this.diagnose({
      code: 'dispose/failure',
      operation,
      expected: 'telemetry only while the mount is live',
      observed: 'a telemetry call arrived after the mount was disposed',
      repair: 'Cancel the work that produced it with the mount abort signal.',
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
        repair: 'Guard the computation before measuring; the observation was not recorded.',
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
   * A framework lifecycle diagnostic, deduplicated against errors the mount has
   * already reported so one failure never produces two records.
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
