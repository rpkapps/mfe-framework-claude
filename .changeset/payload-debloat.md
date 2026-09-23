---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-legacy-angular': minor
'@company/mfe-rspack': patch
---

Cut the shipped payload of `@company/mfe-core`, `@company/mfe-runtime` and `@company/mfe-react`: ~10% off a shell's bundle, ~14% off what every container replicates.

- **Breaking:** `declaredBy` and `note` are removed from `MfeErrorDetails`; `code`, `id`, `operation`, `path` and `cause` are unchanged, and `repair`/`expected`/`observed` survive. Remove any use of the two fields.
- **Breaking:** test doubles (`createInProcessLoader`, `createMemoryNavigationBridge`, `createMemoryStorageArea`, `createRecordingTelemetryProvider`) moved to `@company/mfe-runtime/testing`; import them from that subpath instead of the package root.
- **Breaking:** `SessionTransitionResult.invalidated` is removed — use `outcome === 'invalidated'`; `ContractValidationContext.note` is removed with no replacement.
- Developer-only diagnostics (telemetry, undeclared-origin and competing-breadcrumb warnings, the reserved-context-key scan) now run only behind `DEV` and are stripped from production builds.
