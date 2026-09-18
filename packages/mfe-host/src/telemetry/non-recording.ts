/**
 * The non-recording span and tracer, and the provider that keeps nothing.
 *
 * A non-recording handle is what a caller gets when tracing is off, when the
 * mount has been disposed, when the provider's tracer could not be built, or
 * when the open-span budget is exhausted. It satisfies the whole `Span` surface
 * and does nothing, so author code needs no null checks of its own.
 */

import type { Span, SpanOptions, TelemetryProvider, Tracer } from '@company/mfe-core'

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

/**
 * A tracer whose spans never record. `startActiveSpan` still invokes the
 * application callback exactly once and returns its result unchanged, so
 * turning tracing off cannot change what the application does.
 */
export function createNonRecordingTracer(): Tracer {
  function startActiveSpan<T>(name: string, callback: (span: Span) => T): T
  function startActiveSpan<T>(name: string, options: SpanOptions, callback: (span: Span) => T): T
  function startActiveSpan<T>(
    _name: string,
    optionsOrCallback: SpanOptions | ((span: Span) => T),
    maybeCallback?: (span: Span) => T,
  ): T {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
    if (typeof callback !== 'function') return undefined as unknown as T
    return callback(nonRecordingSpan)
  }

  return Object.freeze({
    startSpan: (): Span => nonRecordingSpan,
    startActiveSpan,
  })
}

/**
 * A provider that keeps nothing: the default in a shell that has not wired a
 * backend yet. It declares every level disabled, so the binding drops leveled
 * records before it builds them.
 */
export function createNoopTelemetryProvider(): TelemetryProvider {
  const tracer: Tracer = createNonRecordingTracer()
  return Object.freeze({
    record: (): void => {},
    createTracer: (): Tracer => tracer,
    isLevelEnabled: (): boolean => false,
  })
}
