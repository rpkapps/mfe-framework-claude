/**
 * What a shell wires telemetry with: the provider it starts from, the diagnostics sink and the one
 * span implementation. The mount-bound service itself is the runtime's, handed to each mount.
 * No vendor telemetry package is imported here, so an author bundle never resolves one.
 */

export { telemetryDiagnosticsSink } from './diagnostics-sink.ts'

export { createNoopTelemetryProvider } from './tracer.ts'

export { createSpanEmitter } from './span-emitter.ts'
