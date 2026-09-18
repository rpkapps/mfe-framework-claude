/**
 * The framework-owned tracer and span.
 *
 * The provider's tracer is the sink, not the brain: the host owns span
 * identity, parentage and the active context, and passes the resolved ids down
 * as reserved attributes so a shell adapter can rebuild the tree from a single
 * record. The provider seam cannot express "start this span under that parent",
 * and provider-side callback nesting breaks at the first `await`. No vendor
 * package is imported here; a boundary check enforces that.
 */

import {
  boundAttributes,
  boundName,
  SpanKind,
  TELEMETRY_LIMITS,
  type Span,
  type SpanOptions,
  type SpanStatus,
  type TelemetryAttributes,
  type Tracer,
} from '@company/mfe-core'

import { isReservedAttributeKey, RESERVED_ATTRIBUTE_KEYS } from './attribution.ts'
import { getActiveSpanContextFor, runWithSpanContext, type ActiveSpanContext } from './context.ts'
import { nonRecordingSpan } from './non-recording.ts'
import type { MountTelemetryRuntime } from './runtime.ts'

/** How a span that outlived its mount is labelled. Never an error status. */
const CANCELLATION_REASON = 'mount-disposed'

/**
 * OpenTelemetry's id shapes (128-bit trace id, 64-bit span id, lowercase hex)
 * are a wire convention, not a vendor API, so mirroring them keeps a shell
 * adapter's translation trivial without importing `@opentelemetry/*`.
 */
function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount)
  const source: Crypto | undefined = globalThis.crypto
  if (source !== undefined && typeof source.getRandomValues === 'function') {
    source.getRandomValues(bytes)
  } else {
    // Ids only need to be unique inside one page session, never unguessable, so
    // a weaker source degrades correlation quality and nothing else.
    for (let index = 0; index < byteCount; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

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

  /** Forwards to the provider's span under containment, when there still is one. */
  #forward(operation: string, call: (inner: Span) => unknown): this {
    const inner = this.#inner
    if (inner !== undefined) this.#runtime.safeProviderCall(operation, () => call(inner))
    return this
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
    const boundedValue = boundAttributes({ [key]: value })[key]
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
    return this.#forward('set a span attribute', inner => inner.setAttribute(key, boundedValue))
  }

  setAttributes(attributes: TelemetryAttributes): Span {
    if (this.#refuseAfterEnd('set span attributes')) return this
    // Reserved attribution is already on the span from creation; re-sending it
    // would be noise, so only the author's own clamped keys go down.
    const authored: Record<string, string | number | boolean> = {}
    for (const [key, value] of Object.entries(
      this.#runtime.mergeAttributes(attributes, 'set span attributes'),
    )) {
      if (!isReservedAttributeKey(key)) authored[key] = value
    }
    if (Object.keys(authored).length === 0) return this
    return this.#forward('set span attributes', inner => inner.setAttributes(Object.freeze(authored)))
  }

  addEvent(name: string, attributes?: TelemetryAttributes): Span {
    if (this.#refuseAfterEnd('add a span event')) return this
    const bounded = boundAttributes(attributes)
    return this.#forward('add a span event', inner => inner.addEvent(boundName(name), bounded))
  }

  setStatus(status: SpanStatus): Span {
    if (this.#refuseAfterEnd('set a span status')) return this
    const bounded: SpanStatus = {
      code: status.code,
      ...(status.message === undefined ? {} : { message: boundName(status.message) }),
    }
    return this.#forward('set a span status', inner => inner.setStatus(bounded))
  }

  recordException(error: unknown, attributes?: TelemetryAttributes): Span {
    if (this.#refuseAfterEnd('record a span exception')) return this
    const bounded = boundAttributes(attributes)
    return this.#forward('record a span exception', inner => inner.recordException(error, bounded))
  }

  /** Repeated calls are harmless: the first one wins and the rest do nothing. */
  end(endTime?: number): void {
    if (this.#ended) return
    this.#tracer.releaseSpan(this)
    this.#close('end a span', endTime)
  }

  isRecording(): boolean {
    return !this.#ended && this.#inner !== undefined
  }

  /**
   * Disposal finalization for a span the author forgot. Its status is left
   * exactly as the author left it: a mount going away is not a failure of the
   * work the span described, and an error status would invent alerts.
   */
  finalizeCancelled(endTime: number): void {
    if (this.#ended) return
    this.#forward('finalize a cancelled span', inner =>
      inner.setAttributes(
        Object.freeze({
          [RESERVED_ATTRIBUTE_KEYS.cancelled]: true,
          [RESERVED_ATTRIBUTE_KEYS.endReason]: CANCELLATION_REASON,
        }),
      ),
    )
    this.#close('finalize a cancelled span', endTime)
  }

  #close(operation: string, endTime: number | undefined): void {
    const inner = this.#inner
    this.#ended = true
    this.#inner = undefined
    if (inner !== undefined) {
      this.#runtime.safeProviderCall(operation, () => inner.end(endTime))
    }
  }
}

export class MountTracer implements Tracer {
  readonly #runtime: MountTelemetryRuntime
  /** Bounded tracking, so spans nobody ended cannot grow memory without limit. */
  readonly #open = new Set<MountSpan>()
  #inner: Tracer | undefined

  constructor(runtime: MountTelemetryRuntime, options: { readonly enabled: boolean }) {
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
    const traceId = parent?.traceId ?? randomHex(16)
    const spanId = randomHex(8)
    const spanName = boundName(name)

    const attributes: TelemetryAttributes = Object.freeze({
      ...this.#runtime.mergeAttributes(options?.attributes, 'start a span'),
      [RESERVED_ATTRIBUTE_KEYS.traceId]: traceId,
      [RESERVED_ATTRIBUTE_KEYS.spanId]: spanId,
      ...(parent === undefined ? {} : { [RESERVED_ATTRIBUTE_KEYS.parentSpanId]: parent.spanId }),
    })

    const innerSpan = this.#runtime.safeProviderCall('start a span', () =>
      inner.startSpan(spanName, {
        kind: options?.kind ?? SpanKind.INTERNAL,
        attributes,
        ...(options?.startTime === undefined ? {} : { startTime: options.startTime }),
      }),
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

    // A non-recording handle carries no id to parent anything to. The ambient
    // context is left untouched so a surrounding span keeps adopting children
    // created inside, instead of leaving a silent gap.
    if (!(span instanceof MountSpan)) return callback(span)

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
    const open = [...this.#open]
    this.#open.clear()
    this.#inner = undefined
    if (open.length === 0) return { finalized: 0, names: [] }

    const endTime = this.#runtime.now()
    for (const span of open) span.finalizeCancelled(endTime)
    this.#runtime.counters.spansFinalizedAtDisposal += open.length
    return { finalized: open.length, names: open.map(span => span.name) }
  }
}
