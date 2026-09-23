---
'@company/mfe-angular': minor
---

The Angular adapter places every definition through the runtime's `mountDefinition`, and gains a `/host` entry point.

- **Host components.** `<mfe-widget>` and `<mfe-app-host>` keep their inputs and outputs and mount through `mountDefinition`, so they never ask which framework built what they place.
  - A new public `status` signal reads `pending`, `mounted`, `error` or `disposed`.
  - `(failed)` also emits for a failure after mounting.
  - `retry()` acts only after a failure. A failed load is loaded afresh.
  - An `[inputs]` change reaches the Widget only when it changed, and inputs set while it mounts arrive once.
  - Placed inside a mount, a definition is one level deeper and is disposed with that mount.
  - A routed `<mfe-app-host>` calls `navigator.announce()` after every `NavigationEnd`, so an App below a shell router that writes the page's history directly follows the shell.
- **Definitions.** `createApp` and `createWidget` mounts render into `target.element` and add no scope or overlay root; both are the runtime's. An application destroyed by anything but the mount's own `dispose` is reported through `target.onFailure`. A Widget's `update` no longer compares inputs itself, because the host passes only a set that changed.
- **`injectMfeMount().scopeRoot`** is the runtime's scope root for the mount, reachable from a definition's environment providers as well as its components.
- **`@company/mfe-angular/host`** is new: `export * from '@company/mfe-runtime'` plus `provideMfeRuntime`.
- **`@company/mfe-angular/testing`** re-exports `@company/mfe-runtime/testing`. `mountApp` and `mountWidget` now mount through `mountDefinition`, and `element` is the runtime's scope root.
  - **Breaking:** an `environment` passed to them must list the definition in its `definitions`.
  - **Breaking:** `MountAppOptions.depth` is gone; depth comes from where a definition is placed.
- **Breaking:** removed from the root: `createMfeRuntime` and `CreateRuntimeOptions`; the shell lists every adapter itself, through `createMfeRuntime` from `/host`. `createMf2ContainerLoader` and `Mf2LoaderOptions` are gone; use `createFederationContainerLoader` from `/host`. `isAngularDefinition` is gone, because hosts never branch on framework. `angularAdapter` and `AngularRegistryEntry` are now on `/registry` only. The neutral host names (`isFederatedEntry`, `isMountableDefinition`, the scope attribute names, `FederatedRegistryEntry`, `MfeRuntimeHandle`, `MountableDefinition`) are now on `/host`. The root keeps `MfeRuntime` and `MountContext`, and adds `MountStatus`.
