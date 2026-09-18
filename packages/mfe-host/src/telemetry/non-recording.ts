/**
 * The non-recording span and tracer.
 *
 * A non-recording handle is what a caller gets when tracing is switched off,
 * when the mount has been disposed, when the provider's tracer could not be
 * built, or when the open-span budget is exhausted. It satisfies the whole
 * `Span` surface, reports `isRecording() === false`, and does nothing else, so
 * author code needs no null checks and no feature flag of its own.
 */

import type { Span, SpanOptions, Tracer } from '@company/mfe-core'

/**
 * One frozen instance is enough: the handle carries no state, and sharing it
 * keeps a disabled mount from allocating per call.
 */
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
