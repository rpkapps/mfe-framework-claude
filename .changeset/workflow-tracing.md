---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
---

A workflow can be one trace (§58). `tracer.withSpan(span, fn)` runs `fn` with a span the author kept active again, so a later click or the work after an `await` joins its trace. Every record made while a span is active carries its `spanContext`, and a `SpanRecord` carries its own `spanContext` and `parentSpanId`. A request through `#mfe/fetch` to a declared API, sent while a span is active, gets a `CLIENT` span and a W3C `traceparent` header; undeclared origins and a caller's own `traceparent` are left alone. A provider's `createTracer` returns a tracer without `withSpan`, which the mount's tracer owns.
