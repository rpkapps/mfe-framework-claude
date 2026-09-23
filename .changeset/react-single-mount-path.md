---
'@company/mfe-react': minor
---

The React adapter places every definition through the runtime's `mountDefinition`, React ones included, and gains `/host` and `/registry` entry points.

- **Host components.** `AppHost`, `DynamicWidget`, the component `lazyWidget` returns and `mfeRoute` render an empty element and mount the definition into it through `mountDefinition`. They never ask which framework built what they place, and a React definition opens a React root of its own, so several React versions can share a page.
  - **Behaviour:** nothing suspends. `AppHostProps.pending` is new, beside the Widgets' existing `pending`, and fills the region while the container loads and the definition mounts.
  - `fallback({ error, retry })` also shows a failure after mounting, such as a root that unmounted itself. Without a `fallback` the failure is thrown to the nearest error boundary, as before.
  - `retry()` acts only after a failure, and a failed load is loaded afresh.
  - Under StrictMode the first mount is disposed before its load settles, so a definition's `mount` runs once.
  - A Widget is handed only inputs that changed; its handlers are read when an event arrives, so replacing one never remounts it. Events reach the `onX` prop their name maps to and then `onEvent`, without a contract.
  - Placed inside a mount, a definition is one level deeper and is disposed with that mount.
  - `mfeRoute` calls `navigator.announce()` when its router's location changes, and derives the boundary from its own match, so a navigation in progress no longer remounts the child App.
- **Definitions.** A React definition's `mount` renders into `target.element` and adds no scope root of its own, which removes the second scope root a React definition placed by another host used to nest. The root sets `identifierPrefix` from the mount token, so `useId` values stay unique across roots, and runs in StrictMode in development. A render failure before the first commit rejects the mount; one after it goes to `target.onFailure`, and recoverable errors to diagnostics. A Widget now gets its own mount's `QueryClientProvider`.
- **`useScopeRoot()`** is new: the runtime's scope root for the mount.
- **`@company/mfe-react/host`** is new: `export * from '@company/mfe-runtime'` plus `MfeProvider`, which is what a React shell boots from.
- **`@company/mfe-react/registry`** is new: `reactAdapter` alone, with no React import.
- **`@company/mfe-react/testing`** re-exports `@company/mfe-runtime/testing`. `mountApp` and `mountWidget` are new: they mount through `mountDefinition` and resolve once the mount settles. `renderApp` and `renderWidget` still render in the test's tree, into the mount's scope root; `renderWidget` no longer checks events against the Widget's own contract a second time.
- **Breaking:** removed from the root: `createMfeRuntime`, `CreateRuntimeOptions` and `MfeRuntimeHandle` (use `createMfeRuntime` from `/host` and list every adapter, `reactAdapter` included); `createMf2ContainerLoader` and `Mf2LoaderOptions` (use `createFederationContainerLoader` from `/host`); `containerNameOf` (use `isFederatedEntry(entry) ? entry.container : undefined`); `createMount`, `CreateMountOptions` and `MountHandleWithCleanup`; `AppMount` and `AppMountProps`; `isReactDefinition` and `isMfeDefinition`, because hosts never branch on framework (`isMountableDefinition` checks what a host needs).
- **Breaking:** `@module-federation/runtime` is no longer a peer dependency.
