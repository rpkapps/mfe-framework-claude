---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
'@company/mfe-build': minor
'@company/mfe-rspack': minor
'@company/mfe-nx': minor
---

Add owner-scoped user context with independently compiled per-MFE schemas and generated React and Angular bindings. Owners receive field reads, ordered asynchronous writes, and subscriptions; explicitly declared cross-owner contracts grant read-only access. Runtime and backend independently authorize writes.

Expose one selector binding per framework: React returns a selected-value tuple with an owned setter; Angular returns a selected-value signal object with an owned setter. Foreign-owner bindings omit writing from their types and values. Track nested fields, clean up subscriptions automatically, and infer declared reader schemas from generated owner maps.

Use the canonical `MfeResult` envelope for setters and publish committed values only. Preserve recursive object merges, array replacement, record revisions, synchronization, and durable persistence. Scope transitions invalidate old bindings and clear client caches without deleting server records. Persistence stores opaque per-user owner slices without domain schemas. Custom persistence adapters classify backend failures with `UserContextError` and the exported `USER_CONTEXT_ERROR_CODES`; services expose read-only `inspection` that the devtools User Context tab renders, with **Current value** including pending writes and **Confirmed** showing what consumers read. Normal builds require no baseline configuration; owners can compare contracts in standalone release tooling.

Hosts can derive the shell theme from their own context with `createMfeRuntime({ theme: { select, cacheKey } })`. The framework keeps a startup cache partitioned by tenant, account and user; `themeCacheKey`, `readCachedTheme` and `resolveTheme` let a prepaint bootstrap read it without applying another user's preference.
