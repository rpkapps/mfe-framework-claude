---
'@company/mfe-core': minor
'@company/mfe-host': minor
'@company/mfe-react': minor
'@company/mfe-devtools': patch
---

The host page has a scope of its own — `HOST_SCOPE`, `'@host'` — so it stores
state, registers commands and breadcrumbs, and reads the registry as itself.

- **Storage**: `MfeStorageStore.bindHost(declaration)`, `hostStorage(area?)`,
  `establishSessionGeneration(store, identity)`, `mintSessionGeneration()`, and
  `useStoredState` outside a mount. The definition-scoped paths refuse `@host`.
- **Commands and breadcrumbs**: `CommandRegistry.registerHost(registration)`,
  with `register()` refusing the host scope. `useCommand` outside a mount
  registers there, `useBreadcrumbs` outside one publishes at depth 0.
- **Registry selectors**: `useRegistryEntries`, `useApps`, `useWidgets`,
  `useCapabilityPages(name?)` and `useActiveDefinition(pathname)`, over
  `boundaryDefinitionId(url)` without React.
- **Diagnostics**: `createMfeRuntime({ diagnostics })` adopts a hub the host
  built first — `installShellAuth` runs before the runtime — and disposes only
  the sinks it added. `telemetryDiagnosticsSink(provider)` is the translation
  from a `Diagnostic` to a `TelemetryRecord`, and `new DiagnosticsHub(sinks)`
  takes its sinks up front. `@company/mfe-host` re-exports `DiagnosticsHub` and
  its types.
- **Session and storage ownership**: `createMfeRuntime` builds the store and
  establishes the first session generation for the identity in `shellState`
  when no `sessionGeneration` is given, so a host needs neither before the
  runtime. There is no `storage` option.

**No storage keys are migrated.** A host record's key is `@host:<name>`, so
state kept under a shell's own key is neither read nor rewritten: clear it, or
declare `migrate()`. A reader outside the store — a pre-paint script — gets the
store's envelope rather than a bare value.

**`useTheme`, `useUser` and `useGroups` no longer require a mount**; with no
runtime at all they report `useMfeRuntime`'s failure, not `useMfeMount`'s.
