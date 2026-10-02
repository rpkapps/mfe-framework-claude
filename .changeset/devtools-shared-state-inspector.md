---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-devtools': minor
---

Add a live, read-only Shared State devtools inspector using Tecton components. Search contracts and inspect hydration status, record revisions, pending writes, current and confirmed JSON, errors, and the canonical schema. Copy complete JSON while large previews remain bounded.

SharedStateRuntime exposes optional immutable, cached diagnostics without hydrating or binding state. Inspection subscriptions survive scope changes, publish new scopes atomically, and clear values on disposal. Custom shared-state services without inspection remain compatible.
