---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-devtools': minor
---

Add a live, read-only User Context devtools inspector using Tecton components. Search owners or `owner:key` addresses, and inspect each loaded owner's status, record revision, stored value per key, the error that made it invalid, and its schema as JSON Schema. Copy complete JSON while large previews remain bounded.

`UserContextRuntime` exposes immutable, cached diagnostics without hydrating or binding state. Inspection subscriptions survive a signed-in user change and clear every value when it happens or on disposal. Custom user-context services without inspection remain compatible.
