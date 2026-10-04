/**
 * The framework-owned tracer and span behind a mount's workflows: thin objects that forward to the
 * provider's tracer. The host owns span identity and parentage and passes the resolved ids down as
 * reserved attributes, because the provider seam cannot express "start this span under that
 * parent".
 */

import {
  boundName,
  SpanKind,
  TELEMETRY_LIMITS,
  type Span,
  type SpanStatusCode,
  type TelemetryAttributes,
  type TelemetryProvider,
  type TelemetrySpanContext,
  type Tracer,
} from '@company/mfe-core'

import { DEV } from '../dev.ts'
import {
  isReservedAttributeKey,
  RESERVED_ATTRIBUTE_KEYS,
  type MountTelemetryRuntime,
} from './runtime.ts'
import { createNonRecordingTracer } from './span-emitter.ts'

/** A provider that keeps nothing: the default before a shell wires a backend. */
export function createNoopTelemetryProvider(): TelemetryProvider {
  const tracer = createNonRecordingTracer()
  return Object.freeze({
    record: (): void => {},
    createTracer: (): Tracer => tracer,
    // Every level disabled, so leveled records are dropped before being built.
    isLevelEnabled: (): boolean => false,
  })
}

/**
 * OpenTelemetry's id shapes are a wire convention, not a vendor API, so mirroring them keeps a
 * shell adapter's translation trivial; ids need only be unique inside one page session.
 */
function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount)
  const source: Crypto | undefined = globalThis.crypto
  if (source !== undefined && typeof source.getRandomValues === 'function')
    source.getRandomValues(bytes)
  else for (let i = 0; i < byteCount; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** What a workflow does with its spans, and no more. */
export class MountSpan {
  readonly #runtime: MountTelemetryRuntime
  readonly #tracer: MountTracer
  /** Dropped once the span ends, so a change after `end()` never reaches the provider. */
  #inner: Span | undefined
  #ended = false

  constructor(
    runtime: MountTelemetryRuntime,
    tracer: MountTracer,
    inner: Span,
    readonly traceId: string,
    readonly spanId: string,
  ) {
    this.#runtime = runtime
    this.#tracer = tracer
    this.#inner = inner
  }

  /** Forwards to the provider's span, under containment. */
  #forward(operation: string, call: (inner: Span) => unknown): this {
    const inner = this.#inner
    if (inner !== undefined) this.#runtime.safeProviderCall(operation, () => call(inner))
    return this
  }

  /** Clamping and reserved-key rejection stay the runtime's, so spans match records. */
  #applyAttributes(attributes: TelemetryAttributes, operation: string): this {
    const authored: Record<string, string | number | boolean> = {}
    for (const [key, value] of Object.entries(
      this.#runtime.mergeAttributes(attributes, operation),
    )) {
      if (!isReservedAttributeKey(key)) authored[key] = value
    }
    if (Object.keys(authored).length === 0) return this
    return this.#forward(operation, inner => inner.setAttributes(Object.freeze(authored)))
  }

  setAttributes(attributes: TelemetryAttributes): this {
    return this.#applyAttributes(attributes, 'set span attributes')
  }

  setStatus(code: SpanStatusCode): this {
    return this.#forward('set a span status', inner => inner.setStatus({ code }))
  }

  recordException(error: unknown): this {
    return this.#forward('record a span exception', inner => inner.recordException(error))
  }

  /** Repeated calls are harmless: the first one wins and the rest do nothing. */
  end(): void {
    if (this.#ended) return
    this.#tracer.releaseSpan(this)
    this.#close('end a span', undefined)
  }

  /** The status is left as it was: the work was left, not failed. */
  endAbandoned(): void {
    if (this.#ended) return
    this.#tracer.releaseSpan(this)
    const operation = 'end an abandoned span'
    this.#label({ [RESERVED_ATTRIBUTE_KEYS.endReason]: 'abandoned' }, operation)
    this.#close(operation, undefined)
  }

  /**
   * Hands the span to the page's run of its workflow, which another mount is still in: the mount's
   * disposal then leaves it open, and it stops counting against the mount's budget. Ending it
   * after the mount is gone needs nothing disposal closes, because only starting a span and
   * emitting a record are refused then; the span still reaches the provider under the runtime's
   * containment, and the provider's span has no notion of the mount at all.
   */
  detach(): void {
    this.#tracer.releaseSpan(this)
  }

  /** The status is left as it was: a mount going away did not fail the work. */
  finalizeCancelled(endTime: number): void {
    if (this.#ended) return
    const operation = 'finalize a cancelled span'
    this.#label(
      {
        [RESERVED_ATTRIBUTE_KEYS.cancelled]: true,
        [RESERVED_ATTRIBUTE_KEYS.endReason]: 'mount-disposed',
      },
      operation,
    )
    this.#close(operation, endTime)
  }

  /** Reserved keys go straight to the provider, because the author path drops them. */
  #label(attributes: TelemetryAttributes, operation: string): void {
    this.#forward(operation, inner => inner.setAttributes(Object.freeze(attributes)))
  }

  #close(operation: string, endTime: number | undefined): void {
    const inner = this.#inner
    this.#ended = true
    this.#inner = undefined
    if (inner !== undefined) this.#runtime.safeProviderCall(operation, () => inner.end(endTime))
  }
}

export interface MountSpanOptions {
  readonly attributes?: TelemetryAttributes | undefined
  /** Defaults to `INTERNAL`; a request through the framework fetch is a `CLIENT` span. */
  readonly kind?: SpanKind | undefined
  /**
   * Starts the span as this one's child, in its trace; without it the span starts a trace. Only
   * the ids are read, so the parent may be a span another tracer started, or a `traceparent`.
   */
  readonly parent?: TelemetrySpanContext | undefined
}

export class MountTracer {
  readonly #runtime: MountTelemetryRuntime
  /** Bounded tracking, so spans nobody ended cannot grow memory without limit. */
  readonly #open = new Set<MountSpan>()
  #inner: Tracer | undefined

  constructor(runtime: MountTelemetryRuntime, options: { readonly enabled: boolean }) {
    this.#runtime = runtime
    if (!options.enabled) return
    // A provider that throws while building its tracer disables tracing for the mount
    // instead of taking the mount down with it.
    this.#inner = runtime.safeProviderCall('create a tracer', () =>
      runtime.provider.createTracer(runtime.attribution),
    )
  }

  get openSpanCount(): number {
    return this.#open.size
  }

  releaseSpan(span: MountSpan): void {
    this.#open.delete(span)
  }

  /** `undefined` when tracing is off, the mount is gone, the budget is spent or the provider threw. */
  startSpan(name: string, options: MountSpanOptions = {}): MountSpan | undefined {
    const inner = this.#inner
    if (inner === undefined || this.#runtime.disposed) return undefined

    if (this.#open.size >= TELEMETRY_LIMITS.maxOpenSpansPerMount) {
      this.#runtime.counters.spansDroppedAtLimit += 1
      if (DEV) {
        this.#runtime.diagnose({
          code: 'config/invalid',
          operation: 'start a span',
          expected: `at most ${TELEMETRY_LIMITS.maxOpenSpansPerMount} open spans for one mount`,
          observed: `span "${boundName(name)}" while that many were already open`,
          repair:
            'End the workflows you start with succeed() or fail(). The new span does not record.',
          context: { openSpans: this.#open.size },
        })
      }
      return undefined
    }

    const { parent } = options
    const traceId = parent?.traceId ?? randomHex(16)
    const spanId = randomHex(8)
    const spanName = boundName(name)

    const innerSpan = this.#runtime.safeProviderCall('start a span', () =>
      inner.startSpan(spanName, {
        kind: options.kind ?? SpanKind.INTERNAL,
        attributes: Object.freeze({
          ...this.#runtime.mergeAttributes(options.attributes, 'start a span'),
          [RESERVED_ATTRIBUTE_KEYS.traceId]: traceId,
          [RESERVED_ATTRIBUTE_KEYS.spanId]: spanId,
          ...(parent === undefined
            ? {}
            : { [RESERVED_ATTRIBUTE_KEYS.parentSpanId]: parent.spanId }),
        }),
      }),
    )
    if (innerSpan === undefined) return undefined

    const span = new MountSpan(this.#runtime, this, innerSpan, traceId, spanId)
    this.#open.add(span)
    this.#runtime.counters.spansStarted += 1
    return span
  }

  /**
   * Spans left open at disposal are closed as cancelled, never as errors: a user who leaves in the
   * middle of a workflow did not make it fail.
   */
  finalizeOpenSpans(): void {
    const open = [...this.#open]
    this.#open.clear()
    this.#inner = undefined
    if (open.length === 0) return

    const endTime = this.#runtime.now()
    for (const span of open) span.finalizeCancelled(endTime)
    this.#runtime.counters.spansFinalizedAtDisposal += open.length
  }
}
