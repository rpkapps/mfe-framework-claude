---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
---

Breaking: telemetry traces named workflows instead of exposing a tracer (§59). `MfeTelemetry.tracer` is removed; `telemetry.workflow(name)` returns the mount's `Workflow` with that name, the same object every call, with `start(attributes?)`, `step(name, attributes?)`, `headers()`, `succeed(attributes?)` and `fail(error, attributes?)`. A workflow is one trace: a root span with a child span per step. `fail` records the error on both and reports it as an error record whose `spanContext` is the workflow's. Starting a workflow that is open abandons the open run (`mfe.span.end_reason: abandoned`, not an error); steps and ends while it is not open are ignored. `headers()` returns `{ traceparent }` for the current step while open, and `{}` otherwise or with tracing off.

Nothing is ambient any more: `Tracer.startActiveSpan` is removed, records are no longer stamped with an active span's `spanContext`, and `#mfe/fetch` no longer starts a client span or adds `traceparent` — spread `workflow.headers()` into the request instead; a caller's `traceparent` passes through unchanged. `Tracer` is now only the provider seam, `{ startSpan(name, options?) }`, and `TelemetryProvider.createTracer` returns it. Disposing a mount with an open workflow closes its spans as cancelled without a `dispose/failure` diagnostic. `@company/mfe-react` and `@company/mfe-angular` export `Workflow` and no longer export `SpanKind`, `SpanStatusCode`, `Span`, `SpanOptions`, `SpanStatus` or `Tracer`; they remain in `@company/mfe-core` for providers.
