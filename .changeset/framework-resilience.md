---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
'@company/mfe-build': minor
'@company/mfe-rspack': patch
---

Protect independently deployed containers with a shell runtime API handshake, finite shared-load attempts, consumer/provider widget contract checks, and local recovery surfaces.

- Generated container entries and definitions declare the runtime API comparator range `>=1.1.0 <2.0.0`. New shells check it before download and new adapters guard older shells before rendering. Missing historical metadata means the original 1.0.0 API. This contract is independent of package versions and supports stable SemVer comparator conjunctions.
- Shared container attempts now abort and evict at the configured load deadline. Retry starts fresh; late attempts cannot replace newer results. Federation errors requiring a page reload are distinguished from retryable manifest failures.
- React identity and group changes cancel and retire mount query clients and rebuild their provider/router subtree. Temporary component state resets; stored preferences remain. Angular refreshes route guards/resolvers, retires session signals, and fences intercepted HTTP responses from previous sessions. Angular widgets can observe `injectSession()` to refresh their own data.
- Widget hosts expose rejected-update callbacks and accepted/rejected input state independently of mount state. The last valid view remains, with a default stale-input indication. Valid updates clear that indication. React supports `onInputRejected` and `inputFallback`; Angular supports `inputRejected` and an `inputFallback` template.
- Typed consumer contracts are checked against the loaded provider before creating its UI. Detectable mismatches fail locally; opaque constraints are reported as unknown and retain runtime payload validation.
- Default local pending/error surfaces include appropriate retry/reload controls, with host overrides. React fallback callbacks additionally receive `reload`; Angular hosts accept pending/fallback templates.
- Stable widget `instanceId` enables optional `{ scope: 'instance' }` storage on reactive and imperative APIs. Definition scope remains the default and existing keys are unchanged. Instance storage without a stable ID is rejected.

The host prop names `instanceId`, `inputFallback`, and `onInputRejected` are reserved; output names that collide with host handler props are rejected. Toast behavior remains unchanged.
