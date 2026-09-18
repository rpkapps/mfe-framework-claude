/**
 * Telemetry and tracing binding.
 *
 * A provider-neutral telemetry service bound to one mount: identity attached
 * automatically, limits enforced, provider failures contained, and a
 * framework-owned tracer with explicit context propagation. No vendor telemetry
 * package is imported here, so an author bundle never resolves one.
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

export {
  createNonRecordingTracer,
  createNoopTelemetryProvider,
  nonRecordingSpan,
} from './tracer.ts'

export {
  createRecordingTelemetryProvider,
  type RecordingProviderOptions,
  type RecordingTelemetryProvider,
} from './recording-provider.ts'
