/**
 * The framework-owned tracer and span.
 *
 * The shapes follow OpenTelemetry's tracing conventions, but nothing here
 * imports or re-exports a vendor package: a boundary check enforces that, and
 * author bundles must never resolve an OTel or Faro module.
 *
 * The provider's tracer is the sink, not the brain. The host owns span
 * identity, parentage and the active context, and passes the resolved ids down
 * as host-reserved attributes (`mfe.trace.id`, `mfe.span.id`,
 * `mfe.span.parent_id`). That is deliberate: the provider seam has no way to
 * express "start this span under that parent", and asking a provider to infer
 * parentage from its own callback nesting would break the moment an `await`
 * ended the synchronous region. Because the ids travel on the record, a shell
 * adapter can rebuild the tree from a single span, and the host never calls the
 * provider's own `startActiveSpan`.
 */

import {
  boundAttributes,
  boundName,
  SpanKind,
  SpanStatusCode,
  TELEMETRY_LIMITS,
  type Span,
  type SpanOptions,
  type SpanStatus,
  type TelemetryAttributes,
  type Tracer,
} from '@company/mfe-core'

import { isReservedAttributeKey, RESERVED_ATTRIBUTE_KEYS } from './attribution.ts'
import { getActiveSpanContextFor, runWithSpanContext, type ActiveSpanContext } from './context.ts'
import { createSpanId, createTraceId } from './ids.ts'
import { nonRecordingSpan } from './non-recording.ts'
import type { MountTelemetryRuntime } from './runtime.ts'

/** How a span that outlived its mount is labelled. Never an error status. */
const CANCELLATION_REASON = 'mount-disposed'

class MountSpan implements Span {
  readonly traceId: string
  readonly spanId: string
  readonly name: string

  readonly #runtime: MountTelemetryRuntime
  readonly #tracer: MountTracer
  #inner: Span | undefined
  #ended = false

  constructor(
    runtime: MountTelemetryRuntime,
    tracer: MountTracer,
    inner: Span,
    identity: { readonly traceId: string; readonly spanId: string; readonly name: string },
  ) {
    this.#runtime = runtime
    this.#tracer = tracer
    this.#inner = inner
    this.traceId = identity.traceId
    this.spanId = identity.spanId
    this.name = identity.name
  }

  /** True once the span has been ended, whether by the author or by disposal. */
  get ended(): boolean {
    return this.#ended
  }

  #refuseAfterEnd(operation: string): boolean {
    if (!this.#ended) return false
    this.#runtime.counters.mutationsAfterEnd += 1
    this.#runtime.diagnose({
      code: 'config/invalid',
      operation,
      expected: 'changes only while the span is open',
      observed: `a change to span "${this.name}" after it ended`,
      repair:
        'Move the call before end(), or start a new span. The change was ignored so a closed span cannot be rewritten.',
    })
    return true
  }

  setAttribute(key: string, value: string | number | boolean): Span {
    if (this.#refuseAfterEnd('set a span attribute')) return this
    if (isReservedAttributeKey(key)) {
      this.#runtime.counters.reservedOverrideAttempts += 1
      this.#runtime.diagnose({
        code: 'contract/input-mismatch',
        operation: 'set a span attribute',
        expected: 'an attribute key outside the host-owned "mfe." attribution namespace',
        observed: `reserved key ${key}`,
        repair: 'Rename the attribute. Host-bound attribution and span ids always win.',
      })
      return this
    }
    const bounded = boundAttributes({ [key]: value })
    const boundedValue = bounded[key]
    if (boundedValue === undefined) {
      this.#runtime.diagnose({
        code: 'contract/input-mismatch',
        operation: 'set a span attribute',
        expected: 'a string, a boolean or a finite number',
        observed: `${String(value)} for attribute "${key}"`,
        repair: 'Guard the value before setting it. The attribute was not set.',
      })
      return this
    }
    const inner = this.#inner
    if (inner !== undefined) {
      this.#runtime.safeProviderCall('set a span attribute', () =>
        inner.setAttribute(key, boundedValue),
      )
    }
    return this
  }

  setAttributes(attributes: TelemetryAttributes): Span {
    if (this.#refuseAfterEnd('set span attributes')) return this
    const merged = this.#runtime.mergeAttributes(attributes, 'set span attributes')
    // Reserved attribution is already on the span from creation; re-sending it
    // would be noise, so only the author's own clamped keys go down.
    const authored: Record<string, string | number | boolean> = {}
    for (const [key, value] of Object.entries(merged)) {
      if (!isReservedAttributeKey(key)) authored[key] = value
    }
    const inner = this.#inner
    if (inner !== undefined && Object.keys(authored).length > 0) {
      this.#runtime.safeProviderCall('set span attributes', () =>
        inner.setAttributes(Object.freeze(authored)),
      )
    }
    return this
  }

  addEvent(name: string, attributes?: TelemetryAttributes): Span {
    if (this.#refuseAfterEnd('add a span event')) return this
    const inner = this.#inner
    if (inner !== undefined) {
      const bounded = boundAttributes(attributes)
      this.#runtime.safeProviderCall('add a span event', () =>
        inner.addEvent(boundName(name), bounded),
      )
    }
    return this
  }

  setStatus(status: SpanStatus): Span {
    if (this.#refuseAfterEnd('set a span status')) return this
    const inner = this.#inner
    if (inner !== undefined) {
      const bounded: SpanStatus = {
        code: status.code,
        ...(status.message === undefined ? {} : { message: boundName(status.message) }),
      }
      this.#runtime.safeProviderCall('set a span status', () => inner.setStatus(bounded))
    }
    return this
  }

  recordException(error: unknown, attributes?: TelemetryAttributes): Span {
    if (this.#refuseAfterEnd('record a span exception')) return this
    const inner = this.#inner
    if (inner !== undefined) {
      const bounded = boundAttributes(attributes)
      this.#runtime.safeProviderCall('record a span exception', () =>
        inner.recordException(error, bounded),
      )
    }
    return this
  }

  /** Repeated calls are harmless: the first one wins and the rest do nothing. */
  end(endTime?: number): void {
    if (this.#ended) return
    this.#ended = true
    this.#tracer.releaseSpan(this)
    const inner = this.#inner
    this.#inner = undefined
    if (inner !== undefined) {
      this.#runtime.safeProviderCall('end a span', () => inner.end(endTime))
    }
  }

  isRecording(): boolean {
    return !this.#ended && this.#inner !== undefined
  }

  /**
   * Disposal finalization for a span the author forgot. It is marked as
   * cancelled and closed, and its status is left exactly as the author left it:
   * a mount going away is not a failure of the work the span described, and
   * turning it into an error status would invent alerts.
   */
  finalizeCancelled(endTime: number): void {
    if (this.#ended) return
    const inner = this.#inner
    if (inner !== undefined) {
      this.#runtime.safeProviderCall('finalize a cancelled span', () =>
        inner.setAttributes(
          Object.freeze({
            [RESERVED_ATTRIBUTE_KEYS.cancelled]: true,
            [RESERVED_ATTRIBUTE_KEYS.endReason]: CANCELLATION_REASON,
          }),
        ),
      )
    }
    this.#ended = true
    this.#inner = undefined
    if (inner !== undefined) {
      this.#runtime.safeProviderCall('finalize a cancelled span', () => inner.end(endTime))
    }
  }
}

export interface MountTracerOptions {
  /** False turns tracing off entirely: the provider is never asked for a tracer. */
  readonly enabled: boolean
}

export class MountTracer implements Tracer {
  readonly #runtime: MountTelemetryRuntime
  /** Bounded tracking, so spans nobody ended cannot grow memory without limit. */
  readonly #open = new Set<MountSpan>()
  #inner: Tracer | undefined

  constructor(runtime: MountTelemetryRuntime, options: MountTracerOptions) {
    this.#runtime = runtime
    if (!options.enabled) return
    // A provider that throws while building its tracer disables tracing for the
    // mount instead of taking the mount down with it.
    this.#inner = runtime.safeProviderCall('create a tracer', () =>
      runtime.provider.createTracer(runtime.attribution),
    )
  }

  get openSpanCount(): number {
    return this.#open.size
  }

  /** Names of the spans still open, for a disposal diagnostic. */
  get openSpanNames(): readonly string[] {
    return [...this.#open].map(span => span.name)
  }

  releaseSpan(span: MountSpan): void {
    this.#open.delete(span)
  }

  startSpan(name: string, options?: SpanOptions): Span {
    const inner = this.#inner
    if (inner === undefined || this.#runtime.disposed) return nonRecordingSpan

    if (this.#open.size >= TELEMETRY_LIMITS.maxOpenSpansPerMount) {
      this.#runtime.counters.spansDroppedAtLimit += 1
      this.#runtime.diagnose({
        code: 'config/invalid',
        operation: 'start a span',
        expected: `at most ${TELEMETRY_LIMITS.maxOpenSpansPerMount} open spans for one mount`,
        observed: `span "${boundName(name)}" while that many were already open`,
        repair:
          'End the spans you start, in a finally block. The new span is a non-recording handle so the code still runs.',
        context: { openSpans: this.#open.size },
      })
      return nonRecordingSpan
    }

    // Parentage comes from this mount's active context only. An interleaved
    // mount's context is visible in the same slot but belongs to someone else,
    // so it is ignored and the span becomes a root instead of a wrong child.
    const parent = getActiveSpanContextFor(this.#runtime.owner)
    const traceId = parent?.traceId ?? createTraceId()
    const spanId = createSpanId()
    const spanName = boundName(name)

    const authored = this.#runtime.mergeAttributes(options?.attributes, 'start a span')
    const attributes: TelemetryAttributes = Object.freeze({
      ...authored,
      [RESERVED_ATTRIBUTE_KEYS.traceId]: traceId,
      [RESERVED_ATTRIBUTE_KEYS.spanId]: spanId,
      ...(parent === undefined ? {} : { [RESERVED_ATTRIBUTE_KEYS.parentSpanId]: parent.spanId }),
    })

    const innerOptions: SpanOptions = {
      kind: options?.kind ?? SpanKind.INTERNAL,
      attributes,
      ...(options?.startTime === undefined ? {} : { startTime: options.startTime }),
    }

    const innerSpan = this.#runtime.safeProviderCall('start a span', () =>
      inner.startSpan(spanName, innerOptions),
    )
    if (innerSpan === undefined) return nonRecordingSpan

    const span = new MountSpan(this.#runtime, this, innerSpan, { traceId, spanId, name: spanName })
    this.#open.add(span)
    this.#runtime.counters.spansStarted += 1
    return span
  }

  startActiveSpan<T>(name: string, callback: (span: Span) => T): T
  startActiveSpan<T>(name: string, options: SpanOptions, callback: (span: Span) => T): T
  startActiveSpan<T>(
    name: string,
    optionsOrCallback: SpanOptions | ((span: Span) => T),
    maybeCallback?: (span: Span) => T,
  ): T {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
    const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback

    if (typeof callback !== 'function') {
      // Only reachable from untyped JavaScript. Throwing here would turn a
      // telemetry mistake into an application failure, so it is a diagnostic.
      this.#runtime.diagnose({
        code: 'contract/input-mismatch',
        operation: 'start an active span',
        expected: 'a callback as the last argument',
        observed: 'no callback',
        repair: 'Call startActiveSpan(name, callback) or startActiveSpan(name, options, callback).',
      })
      return undefined as unknown as T
    }

    const span = options === undefined ? this.startSpan(name) : this.startSpan(name, options)

    if (!(span instanceof MountSpan)) {
      // A non-recording handle carries no id to parent anything to. The ambient
      // context is left untouched so the surrounding span - if there is one -
      // keeps adopting the children created inside, instead of a silent gap.
      // The callback still runs exactly once and its result is untouched.
      return callback(span)
    }

    const context: ActiveSpanContext = {
      owner: this.#runtime.owner,
      traceId: span.traceId,
      spanId: span.spanId,
      name: span.name,
    }

    // Neither the span nor the exception is handled here: ending the span and
    // recording a failure are the author's decisions. Synchronous throws,
    // returned values and returned promises all pass straight through.
    return runWithSpanContext(context, () => callback(span))
  }

  /**
   * Ends every span still open at disposal and drops the references. Spans are
   * closed as cancelled, never as errors, and the caller reports the leak as a
   * development diagnostic.
   */
  finalizeOpenSpans(): { readonly finalized: number; readonly names: readonly string[] } {
    if (this.#open.size === 0) {
      this.#inner = undefined
      return { finalized: 0, names: [] }
    }
    const open = [...this.#open]
    const names = open.map(span => span.name)
    this.#open.clear()
    const endTime = this.#runtime.now()
    for (const span of open) span.finalizeCancelled(endTime)
    this.#runtime.counters.spansFinalizedAtDisposal += open.length
    this.#inner = undefined
    return { finalized: open.length, names }
  }
}

/** Exposed for tests that assert on the neutral status default. */
export const UNSET_STATUS: SpanStatus = Object.freeze({ code: SpanStatusCode.UNSET })
