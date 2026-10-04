/**
 * The mount-scoped telemetry runtime. A failure of the telemetry path is contained, never
 * reported back through the path that failed, and every `diagnose` call site is
 * wrapped in `if (DEV)` so a production build drops the prose rather than skipping it.
 */

import {
  boundAttributes,
  boundName,
  createMfeError,
  EMPTY_ATTRIBUTES,
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
  type TelemetrySpanContext,
} from '@company/mfe-core'

import { DEV } from '../dev.ts'

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
  endReason: 'mfe.span.end_reason',
} as const

const RESERVED_KEYS: ReadonlySet<string> = new Set<string>(Object.values(RESERVED_ATTRIBUTE_KEYS))

/** The attribution fields, in the order they are bound onto every record. */
const ATTRIBUTION_FIELDS = [
  'definitionId',
  'definitionKind',
  'definitionVersion',
  'buildHash',
  'mountToken',
] as const satisfies readonly (keyof TelemetryAttribution)[]

export interface DiagnosticDetails {
  readonly code: MfeErrorCode
  readonly operation: string
  readonly expected?: string
  readonly observed?: string
  readonly repair?: string
  readonly context?: Readonly<Record<string, string | number | boolean>>
}

export interface TelemetryRuntimeOptions {
  /** The host wires this to its diagnostics hub. */
  readonly onDiagnostic?: DiagnosticsSink
  /** Defaults to "not a production build"; diagnostics are silent when false. */
  readonly dev?: boolean
  /** Per-mount diagnostic budget; beyond it diagnostics are dropped. */
  readonly maxDiagnostics?: number
  /** Injectable clock, for deterministic tests. */
  readonly now?: () => number
}

/** Everything the telemetry service and the tracer share for one mount. */
export class MountTelemetryRuntime {
  readonly provider: TelemetryProvider
  readonly attribution: TelemetryAttribution

  readonly #reserved: TelemetryAttributes
  readonly #onDiagnostic: DiagnosticsSink | undefined
  readonly #dev: boolean
  readonly #maxDiagnostics: number
  readonly #clock: () => number
  #diagnosticsEmitted = 0
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

  /**
   * The diagnostics sink is a different sink, so reporting a provider failure there is not
   * recursive.
   */
  safeProviderCall<T>(operation: string, call: () => T): T | undefined {
    try {
      return call()
    } catch (failure) {
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
    if (this.#diagnosticsEmitted >= this.#maxDiagnostics) return
    this.#diagnosticsEmitted += 1

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
      // Never re-reported: a sink that reported its own failure would recurse forever.
    }
  }

  /**
   * The author's attributes, bounded and without the host-owned keys. A forged reserved key is
   * dropped rather than passed through looking like attribution, and reported to this mount even
   * when the attributes are for a span another mount started.
   */
  authoredAttributes(
    author: TelemetryAttributes | undefined,
    operation: string,
  ): TelemetryAttributes {
    const bounded = boundAttributes(author)
    const keys = Object.keys(bounded)
    if (keys.length === 0) return EMPTY_ATTRIBUTES

    const collisions: string[] = []
    const authored: Record<string, string | number | boolean> = {}
    for (const key of keys) {
      const value = bounded[key]
      if (RESERVED_KEYS.has(key)) collisions.push(key)
      else if (value !== undefined) authored[key] = value
    }

    if (collisions.length > 0) {
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
    return Object.freeze(authored)
  }

  /** The author's attributes with the host-bound attribution, which always wins. */
  mergeAttributes(author: TelemetryAttributes | undefined, operation: string): TelemetryAttributes {
    const authored = this.authoredAttributes(author, operation)
    return Object.keys(authored).length === 0
      ? this.#reserved
      : Object.freeze({ ...authored, ...this.#reserved })
  }

  /** True when the call must be refused because the mount is gone. */
  refused(operation: string): boolean {
    if (!this.#disposed) return false
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
      return true
    }
  }

  #deliver(record: TelemetryRecord, operation: string): void {
    this.safeProviderCall(operation, () => {
      this.provider.record(record)
    })
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

  /** `spanContext`, here and below, links the record to the workflow it was made in. */
  emitEvent(
    name: string,
    attributes: TelemetryAttributes | undefined,
    spanContext?: TelemetrySpanContext,
  ): void {
    const operation = 'record a telemetry event'
    if (this.refused(operation)) return
    this.#deliver(
      {
        kind: 'event',
        name: boundName(name),
        ...withoutUndefined({ spanContext }),
        ...this.#envelope(attributes, operation),
      },
      operation,
    )
  }

  emitLog(
    level: TelemetryLevel,
    message: string,
    attributes: TelemetryAttributes | undefined,
    error?: unknown,
    spanContext?: TelemetrySpanContext,
  ): void {
    const operation = `record a ${level} log`
    if (this.refused(operation)) return
    if (!this.#levelEnabled(level)) {
      return
    }
    this.#deliver(
      {
        kind: 'log',
        level,
        message: boundName(message),
        ...withoutUndefined({ error, spanContext }),
        ...this.#envelope(attributes, operation),
      },
      operation,
    )
  }

  emitError(
    error: unknown,
    attributes: TelemetryAttributes | undefined,
    spanContext?: TelemetrySpanContext,
  ): void {
    const normalized = normalizeError(error)
    // "error.type" is a convenience, not attribution, so an author who supplies it wins.
    const merged = { 'error.type': normalized.name, ...(attributes ?? {}) }
    this.emitLog('error', normalized.message, merged, error, spanContext)
  }

  emitMeasurement(
    name: string,
    value: number,
    unit: MeasurementUnit,
    attributes: TelemetryAttributes | undefined,
    spanContext?: TelemetrySpanContext,
  ): void {
    const operation = 'record a measurement'
    if (this.refused(operation)) return
    if (!Number.isFinite(value)) {
      // NaN and the infinities would poison a histogram downstream, so nothing is
      // recorded at all.
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
        ...withoutUndefined({ spanContext }),
        ...this.#envelope(attributes, operation),
      },
      operation,
    )
  }
}
