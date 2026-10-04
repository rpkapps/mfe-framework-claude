---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
---

A `SpanRecord` carries its own `spanContext` and `parentSpanId`, so a provider can export a span with the framework's ids and a backend span that received its `traceparent` lands in the same trace. `bindTelemetryContext`, `getActiveSpanContext` and `createNonRecordingTracer` are no longer exported: nothing outside the runtime called them.
