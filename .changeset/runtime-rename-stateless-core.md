---
'@company/mfe-runtime': minor
'@company/mfe-core': minor
---

`@company/mfe-host` is now `@company/mfe-runtime`, and `@company/mfe-core` holds contracts only: every stateful piece it carried moved into the runtime.

**`@company/mfe-runtime`**

- **Breaking:** the package `@company/mfe-host` is renamed `@company/mfe-runtime`, and its `/testing` entry is `@company/mfe-runtime/testing`. Replace the dependency and every import; nothing else about the package's entries changed with the name. `@company/mfe-host` receives no further releases. This entry names only the new package because a changeset can name only a package in the workspace.
- An application no longer imports the runtime at all: a shell imports `@company/mfe-react/host` or `@company/mfe-angular/host`, and a test imports the adapter's `/testing`, each of which re-exports the runtime. The lint presets reject `@company/mfe-runtime` and `@company/mfe-core` in application code and name the adapter entry to use instead.
- `MountLifecycle` and `MountLifecycleOptions`, `withDeadline`, `DEFAULT_DEADLINES` and `DeadlineContext`, `DiagnosticsHub`, and `ListenerSet`, `SnapshotSource` and `KeyedListeners` are exported from here, moved from `@company/mfe-core` unchanged.

**`@company/mfe-core`**

- **Breaking:** `MountLifecycle`, `MountLifecycleOptions`, `withDeadline`, `DEFAULT_DEADLINES`, `DeadlineContext`, `DiagnosticsHub`, `ListenerSet`, `SnapshotSource` and `KeyedListeners` are gone. Import them from `@company/mfe-runtime`. Their contract types stay here: `MountState`, `MountHandle`, `AttemptToken`, `DeadlineConfig`, `Diagnostic`, `DiagnosticSeverity`, `DiagnosticsSink`, `Subscribable`, `Listener` and `Unsubscribe`.
- `arrayEqual` and `shallowEqual` are still exported here, now beside the other pure record comparisons.
- The package now holds types, constants and pure validation only — no exported class other than an error, no module-level mutable state, no timer and no browser global — so the build layer, which imports it, never carries page state. A lint zone over its sources enforces this.
