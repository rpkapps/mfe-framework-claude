---
'@company/mfe-core': minor
'@company/mfe-host': minor
'@company/mfe-react': minor
'@company/mfe-legacy-angular': minor
'@company/mfe-rspack': patch
---

Cut the shipped payload of the three browser packages: ~10% off a shell's
bundle and ~14% off the surface every MFE container replicates.

- **`declaredBy` and `note` are gone from `MfeErrorDetails`.** They were prose
  that named _who_ declared a rule rather than what to do about it, and at 89
  call sites they were the single largest category of shipped bytes after
  structure. `code`, `id`, `operation`, `path` and `cause` are unchanged, so
  nothing that handles errors programmatically is affected; `repair`,
  `expected` and `observed` survive and were shortened. **Breaking** for code
  that passes either field to `createMfeError`.

- **A `DEV` constant, and developer-only work guarded with it.** Telemetry
  diagnostics, the undeclared-origin warning, the competing-breadcrumb-override
  warning and the reserved-context-key scan that ran on every navigation are
  now behind `if (DEV)`, so a production build drops the branch, the object it
  built and every sentence inside it rather than running to report nothing.
  `DEV` reads `process.env.NODE_ENV` as a literal member expression on purpose:
  reaching it through `globalThis.process?.env?.[…]` reads as more careful and
  silently defeats the substitution every bundler performs.

- **Test doubles moved to `@company/mfe-host/testing`.** `createInProcessLoader`,
  `createMemoryNavigationBridge`, `createMemoryStorageArea` and
  `createRecordingTelemetryProvider` are full implementations of production
  seams and none of them belongs in a browser bundle. A separate entry point
  makes that structural instead of a tree-shaking hope. **Breaking**: import
  them from the subpath.

- **The shell no longer falls back to the recording provider.** With no
  collector configured it used a test double whose bounded buffers nothing ever
  drained, so a deployed shell accumulated telemetry records for the life of
  the page. It uses `createNoopTelemetryProvider()` now.

- **The storage envelope no longer builds a Zod schema.** `isStorageEnvelope`
  is a hand-written guard: it runs on every read of every key, and the shape is
  four fields the framework itself writes, so a schema there pulled Zod into
  the core bundle to re-check what `serializeEnvelope` had just produced.

- `SessionTransitionResult.invalidated` is gone — it duplicated
  `outcome === 'invalidated'`. `ContractValidationContext.note` is gone with
  the error field. **Breaking** for both.
