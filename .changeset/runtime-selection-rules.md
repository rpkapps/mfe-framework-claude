---
'@company/mfe-react': minor
---

The shell's runtime stops offering a budget nothing enforced, and starts letting a host register its own adapter.

- **Breaking:** `CreateRuntimeOptions.deadlines` and `MfeRuntime.deadlines` are gone. Nothing on the React path ever read them: a load suspends until it settles or fails, and retry is explicit, so the option only promised a 30-second budget that did not exist. `DEFAULT_DEADLINES`, `DeadlineConfig`, `withDeadline` and `MountController` are unchanged in `@company/mfe-core` and `@company/mfe-runtime`, which is where they are used. Later in this release `DEFAULT_DEADLINES` and `withDeadline` moved to `@company/mfe-runtime` alone (`DeadlineConfig` stays in the core), every host moved onto `mountDefinition`, which enforces the deadlines, and `createMfeRuntime({ deadlines })` and `MfeRuntime.deadlines` returned in `@company/mfe-runtime` (see the runtime constructor and mount-definition entries).
- **Breaking:** `MountState` is no longer re-exported from `@company/mfe-react`. No author API returns one — `useMfeSignal()` returns the mount's own `AbortSignal`, not a `MountLifecycle`'s. Import it from `@company/mfe-core` or `@company/mfe-runtime` if you observe a `MountHandle`.
- Superseded in this release by `adapters` and, later, by `createMfeRuntime` moving to `@company/mfe-react/host`: `createMfeRuntime({ rules })` takes extra `AdapterSelectionRule`s, appended after the framework contract rule, which always runs first. `createLegacyAdapterRule()` from `@company/mfe-legacy-angular` can finally be registered: `rules: [createLegacyAdapterRule()]`. `AdapterSelectionRule` is re-exported for a host writing its own.
