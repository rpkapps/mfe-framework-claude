---
'@company/mfe-react': minor
---

The shell's runtime stops offering a budget nothing enforced, and starts letting a host register its own adapter.

- **Breaking:** `CreateRuntimeOptions.deadlines` and `MfeRuntime.deadlines` are gone. Nothing on the React path ever read them: a load suspends until it settles or fails, and retry is explicit, so the option only promised a 30-second budget that did not exist. `DEFAULT_DEADLINES`, `DeadlineConfig`, `withDeadline` and `MountController` are unchanged in `@company/mfe-core` and `@company/mfe-host`, which is where they are used.
- **Breaking:** `MountState` is no longer re-exported from `@company/mfe-react`. No author API returns one — `useMfeSignal()` returns the mount's own `AbortSignal`, not a `MountLifecycle`'s. Import it from `@company/mfe-core` or `@company/mfe-host` if you observe a `MountHandle`.
- `createMfeRuntime({ rules })` takes extra `AdapterSelectionRule`s, appended after the framework contract rule, which always runs first. `createLegacyAdapterRule()` from `@company/mfe-legacy-angular` can finally be registered: `rules: [createLegacyAdapterRule()]`. `AdapterSelectionRule` is re-exported for a host writing its own.
