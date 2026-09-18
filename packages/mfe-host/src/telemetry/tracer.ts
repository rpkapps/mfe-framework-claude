/**
 * The framework-owned tracer and span: thin objects that forward to the
 * provider's tracer.
 *
 * The host owns span identity and parentage and passes the resolved ids down as
 * reserved attributes, because the provider seam cannot express "start this
 * span under that parent" and provider-side callback nesting breaks at the
 * first `await`. No vendor package is imported here; a boundary check enforces
 * that, so an author bundle never resolves one.
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
  type TelemetryProvider,
  type Tracer,
} from '@company/mfe-core'

import {
  isReservedAttributeKey,
  RESERVED_ATTRIBUTE_KEYS,
  type MountTelemetryRuntime,
} from './runtime.ts'

export interface ActiveSpanContext {
  /** Identity of the mount that owns the span. Compared by reference. */
  readonly owner: object
  readonly traceId: string
  readonly spanId: string
  readonly name: string
}

let activeContext: ActiveSpanContext | undefined

/** The active context, whoever owns it. Diagnostics and tests use this. */
export function getActiveSpanContext(): ActiveSpanContext | undefined {
  return activeContext
}

/**
 * The active context, but only when the given mount owns it. Parent resolution
 * goes through here so that an interleaved mount produces a root span instead
 * of a cross-mount parent.
 */
export function getActiveSpanContextFor(owner: object): ActiveSpanContext | undefined {
  return activeContext !== undefined && activeContext.owner === owner ? activeContext : undefined
}

/** Runs `fn` with `context` active, restoring the previous one even on a throw. */
export function runWithSpanContext<T>(context: ActiveSpanContext | undefined, fn: () => T): T {
  const previous = activeContext
  activeContext = context
  try {
    return fn()
  } finally {
    activeContext = previous
  }
}

/**
 * Captures the active context now and restores it for every later invocation of
 * the returned function. A span started after an `await` has no ambient context
 * and becomes a root — never a wrong parent, but never a child either — so this
 * is the supported way to keep a continuation correlated. Create the wrapper
 * while the span is still active, then hand it to the timer or callback.
 */
export function bindTelemetryContext<A extends readonly unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const captured = activeContext
  return (...args: A): R => runWithSpanContext(captured, () => fn(...args))
}

/** How a span that outlived its mount is labelled. Never an error status. */
const CANCELLATION_REASON = 'mount-disposed'

/** One frozen instance: the handle carries no state, so a disabled mount allocates nothing. */
export const nonRecordingSpan: Span = Object.freeze({
  setAttribute: (): Span => nonRecordingSpan,
  setAttributes: (): Span => nonRecordingSpan,
  addEvent: (): Span => nonRecordingSpan,
  setStatus: (): Span => nonRecordingSpan,
  recordException: (): Span => nonRecordingSpan,
  end: (): void => {},
  isRecording: (): boolean => false,
})

/** Splits the two `startActiveSpan` overloads into their parts. */
function activeSpanArgs<T>(
  optionsOrCallback: SpanOptions | ((span: Span) => T),
  maybeCallback: ((span: Span) => T) | undefined,
): { options: SpanOptions | undefined; callback: ((span: Span) => T) | undefined } {
  return typeof optionsOrCallback === 'function'
    ? { options: undefined, callback: optionsOrCallback }
    : { options: optionsOrCallback, callback: maybeCallback }
}

/**
 * A tracer whose spans never record: what a caller gets when tracing is off,
 * when the mount is disposed, when the provider's tracer could not be built, or
 * when the open-span budget is exhausted. The callback still runs exactly once
 * and its result is returned unchanged, so turning tracing off cannot change
 * what the application does.
 */
export function createNonRecordingTracer(): Tracer {
  return Object.freeze({
    startSpan: (): Span => nonRecordingSpan,
    startActiveSpan: <T>(
      _name: string,
      optionsOrCallback: SpanOptions | ((span: Span) => T),
      maybeCallback?: (span: Span) => T,
    ): T => {
      const { callback } = activeSpanArgs(optionsOrCallback, maybeCallback)
      return typeof callback === 'function'
        ? callback(nonRecordingSpan)
        : (undefined as unknown as T)
    },
  })
}

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
 * OpenTelemetry's id shapes (128-bit trace id, 64-bit span id, lowercase hex)
 * are a wire convention rather than a vendor API, so mirroring them keeps a
 * shell adapter's translation trivial without importing `@opentelemetry/*`.
 * Ids only need to be unique inside one page session, never unguessable, so the
 * fallback source degrades correlation quality and nothing else.
 */
function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount)
  const source: Crypto | undefined = globalThis.crypto
  if (source !== undefined && typeof source.getRandomValues === 'function')
    source.getRandomValues(bytes)
  else for (let i = 0; i < byteCount; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

class MountSpan implements Span {
  readonly #runtime: MountTelemetryRuntime
  readonly #tracer: MountTracer
  #inner: Span | undefined
  #ended = false

  constructor(
    runtime: MountTelemetryRuntime,
    tracer: MountTracer,
    inner: Span,
    readonly traceId: string,
    readonly spanId: string,
    readonly name: string,
  ) {
    this.#runtime = runtime
    this.#tracer = tracer
    this.#inner = inner
  }

  /** A change after `end()` is ignored, so a closed span cannot be rewritten. */
  #refuseAfterEnd(operation: string): boolean {
    if (!this.#ended) return false
    this.#runtime.counters.mutationsAfterEnd += 1
    this.#runtime.diagnose({
      code: 'config/invalid',
      operation,
      expected: 'changes only while the span is open',
      observed: `a change to span "${this.name}" after it ended`,
      repair: 'Move the call before end(), or start a new span. The change was ignored.',
    })
    return true
  }

  /** Forwards to the provider's span, under containment. */
  #forward(operation: string, call: (inner: Span) => unknown): this {
    if (this.#refuseAfterEnd(operation)) return this
    const inner = this.#inner
    if (inner !== undefined) this.#runtime.safeProviderCall(operation, () => call(inner))
    return this
  }

  /**
   * Author attributes only: the reserved attribution is already on the span
   * from creation, so re-sending it would be noise. Clamping and reserved-key
   * rejection are the runtime's, so one span cannot diverge from a record.
   */
  #applyAttributes(attributes: TelemetryAttributes, operation: string): this {
    if (this.#refuseAfterEnd(operation)) return this
    const authored: Record<string, string | number | boolean> = {}
    for (const [key, value] of Object.entries(
      this.#runtime.mergeAttributes(attributes, operation),
    )) {
      if (!isReservedAttributeKey(key)) authored[key] = value
    }
    if (Object.keys(authored).length === 0) return this
    return this.#forward(operation, inner => inner.setAttributes(Object.freeze(authored)))
  }

  setAttribute(key: string, value: string | number | boolean): Span {
    const operation = 'set a span attribute'
    if (this.#refuseAfterEnd(operation)) return this
    if (!isReservedAttributeKey(key) && boundAttributes({ [key]: value })[key] === undefined) {
      this.#runtime.diagnose({
        code: 'contract/input-mismatch',
        operation,
        expected: 'a string, a boolean or a finite number',
        observed: `${String(value)} for attribute "${key}"`,
        repair: 'Guard the value before setting it. The attribute was not set.',
      })
      return this
    }
    return this.#applyAttributes({ [key]: value }, operation)
  }

  setAttributes(attributes: TelemetryAttributes): Span {
    return this.#applyAttributes(attributes, 'set span attributes')
  }

  addEvent(name: string, attributes?: TelemetryAttributes): Span {
    return this.#forward('add a span event', inner =>
      inner.addEvent(boundName(name), boundAttributes(attributes)),
    )
  }

  setStatus(status: SpanStatus): Span {
    return this.#forward('set a span status', inner =>
      inner.setStatus({
        code: status.code,
        ...(status.message === undefined ? {} : { message: boundName(status.message) }),
      }),
    )
  }

  recordException(error: unknown, attributes?: TelemetryAttributes): Span {
    return this.#forward('record a span exception', inner =>
      inner.recordException(error, boundAttributes(attributes)),
    )
  }

  isRecording(): boolean {
    return !this.#ended && this.#inner !== undefined
  }

  /** Repeated calls are harmless: the first one wins and the rest do nothing. */
  end(endTime?: number): void {
    if (this.#ended) return
    this.#tracer.releaseSpan(this)
    this.#close('end a span', endTime)
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
    if (inner !== undefined) this.#runtime.safeProviderCall(operation, () => inner.end(endTime))
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
        repair: 'End the spans you start, in a finally block. The new span does not record.',
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

    const innerSpan = this.#runtime.safeProviderCall('start a span', () =>
      inner.startSpan(spanName, {
        kind: options?.kind ?? SpanKind.INTERNAL,
        attributes: Object.freeze({
          ...this.#runtime.mergeAttributes(options?.attributes, 'start a span'),
          [RESERVED_ATTRIBUTE_KEYS.traceId]: traceId,
          [RESERVED_ATTRIBUTE_KEYS.spanId]: spanId,
          ...(parent === undefined
            ? {}
            : { [RESERVED_ATTRIBUTE_KEYS.parentSpanId]: parent.spanId }),
        }),
        ...(options?.startTime === undefined ? {} : { startTime: options.startTime }),
      }),
    )
    if (innerSpan === undefined) return nonRecordingSpan

    const span = new MountSpan(this.#runtime, this, innerSpan, traceId, spanId, spanName)
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
    const { options, callback } = activeSpanArgs(optionsOrCallback, maybeCallback)

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
