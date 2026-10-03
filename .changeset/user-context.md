---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
'@company/mfe-build': minor
'@company/mfe-rspack': minor
'@company/mfe-nx': minor
---

Add owner-scoped user context. Each App or Widget declares `userContext: { schema?, reads? }`: a Zod object for the slice it owns, and the subsets of other owners it reads. The runtime validates with those schemas at runtime, so any schema whose output is JSON works; the build copies each declaration into a module the generated React and Angular bindings infer their types from, and an undeclared owner or key is a compile error. A reader parses only what the owner stored, so give each field the owner may not have written yet a default, or make it optional or nullable.

Expose one selector binding per framework: React returns a selected-value tuple with an owned setter; Angular returns a selected-value signal object with an owned setter. Foreign-owner bindings omit writing from their types and values. Rerender only when the selected value changes, clean up subscriptions automatically, and give router callbacks `context.mfe.userContext`.

Setters return the canonical `MfeResult` once the server accepts the write, and reads show only accepted values. Each write sends one whole key; the server replaces it and bumps the record's revision, the last write of a key wins, and the client keeps a record only when its revision is newer. A failed write rejects only that `set` and reads the owner again. The browser `UserContextAdapter` is scope-free: user context needs a signed-in user, resets when that user changes, and fails the previous user's bindings and requests closed. `createUserContextBackend` takes the user's scope per call and stores opaque per-user owner documents without domain schemas; `scopedUserContextAdapter` binds one to a test user. Custom adapters classify failures with `UserContextError` and the exported `USER_CONTEXT_ERROR_CODES`; services expose a read-only `inspection` that the devtools User Context tab renders.

Hosts declare their own slice, owned under the ID `shell`, beside the adapter in `createMfeRuntime({ userContext: { schema, reads, adapter } })`, and can derive the shell theme from it with `theme: context => context.preferences.theme`. The runtime prepares the shell's slice like a mount's, once per signed-in user, and `runtime.userContext.host.retry()` loads it again after a failure. The runtime then owns the theme: it applies it to shell state and the document, follows the system preference, and keeps a startup cache partitioned by tenant, account and user; `themeBootstrapScript()` returns the inline pre-paint script that reads that cache without applying another user's preference.
