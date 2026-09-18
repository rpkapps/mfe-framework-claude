/**
 * Telemetry and tracing binding.
 *
 * The host binds a provider-neutral telemetry service to one mount: identity is
 * attached automatically, limits are enforced, provider failures are contained,
 * and a framework-owned tracer supplies spans with explicit, honest context
 * propagation. No vendor telemetry package is imported anywhere in this
 * directory, so an author bundle never resolves one.
 */

export {
  createMountTelemetry,
  type FrameworkRecordDetails,
  type MountTelemetryHandle,
  type MountTelemetryOptions,
} from './service.ts'

export { type TelemetryCounters } from './runtime.ts'

export {
  isReservedAttributeKey,
  RESERVED_ATTRIBUTE_KEYS,
  type ReservedAttributeKey,
} from './attribution.ts'

export { bindTelemetryContext, getActiveSpanContext, type ActiveSpanContext } from './context.ts'

export { createNonRecordingTracer, nonRecordingSpan } from './non-recording.ts'

export {
  createRecordingTelemetryProvider,
  type RecordingProviderOptions,
  type RecordingTelemetryProvider,
} from './recording-provider.ts'

export { createNoopTelemetryProvider } from './noop-provider.ts'
