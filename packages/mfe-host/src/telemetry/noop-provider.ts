/**
 * A provider that keeps nothing.
 *
 * Useful as the default in a shell that has not wired a backend yet, in a
 * benchmark, and in tests that only care that author code runs unchanged when
 * telemetry goes nowhere. It declares every level disabled, so the binding
 * drops leveled records before it builds them.
 */

import type { TelemetryProvider, Tracer } from '@company/mfe-core'

import { createNonRecordingTracer } from './non-recording.ts'

export function createNoopTelemetryProvider(): TelemetryProvider {
  const tracer: Tracer = createNonRecordingTracer()
  return Object.freeze({
    record: (): void => {},
    createTracer: (): Tracer => tracer,
    isLevelEnabled: (): boolean => false,
  })
}
