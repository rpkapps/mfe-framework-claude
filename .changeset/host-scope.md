---
'@company/mfe-core': minor
'@company/mfe-host': minor
'@company/mfe-react': minor
'@company/mfe-devtools': patch
---

The host page has its own scope, `HOST_SCOPE` (`'@host'`): it stores state, registers commands and breadcrumbs, and reads the registry as itself.

- **Storage:** `MfeStorageStore.bindHost`, `hostStorage(area?)`, `establishSessionGeneration`, `mintSessionGeneration()`, `useStoredState` outside a mount.
- **Commands/breadcrumbs/selectors:** `CommandRegistry.registerHost`, `useCommand`/`useBreadcrumbs` outside a mount, `useRegistryEntries`, `useApps`, `useWidgets`, `useCapabilityPages(name?)`, `useActiveDefinition(pathname)`.
- **Diagnostics:** `createMfeRuntime({ diagnostics })` adopts a hub the host built; `telemetryDiagnosticsSink(provider)` and `DiagnosticsHub` (re-exported from `@company/mfe-host`).
- `createMfeRuntime` now builds the store and establishes the first session generation itself; the `storage` option is gone, and `useTheme`/`useUser`/`useGroups` no longer require a mount.

**Migration:** a host record's key is `@host:<name>`; state under a shell's own key is untouched, so clear it or declare `migrate()` (legacy `localStorage["theme"]` reads are unaffected, §24).
