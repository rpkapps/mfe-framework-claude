/**
 * A provider-neutral telemetry service bound to one mount, with a framework-owned tracer.
 * No vendor telemetry package is imported here, so an author bundle never resolves one.
 */

export {
  createMountTelemetry,
  type MountTelemetryHandle,
  type MountTelemetryOptions,
} from './service.ts'

export {
  isReservedAttributeKey,
  RESERVED_ATTRIBUTE_KEYS,
  type FrameworkRecordDetails,
  type ReservedAttributeKey,
  type TelemetryCounters,
} from './runtime.ts'

export { bindTelemetryContext, getActiveSpanContext, type ActiveSpanContext } from './tracer.ts'

export { telemetryDiagnosticsSink } from './diagnostics-sink.ts'

export { createNoopTelemetryProvider } from './tracer.ts'

export {
  createNonRecordingTracer,
  createSpanEmitter,
  nonRecordingSpan,
  type SpanEmitterOptions,
} from './span-emitter.ts'
