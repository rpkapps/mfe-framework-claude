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

Use the canonical `MfeResult` envelope for setters and publish committed values only. Preserve recursive object merges, array replacement, record revisions, synchronization, and durable persistence. Scope transitions invalidate old bindings and clear client caches without deleting server records. Optional per-owner baselines replace the global schema/release-policy requirement.
