---
'@company/mfe-react': minor
---

**Breaking:** the root no longer re-exports the runtime's neutral host names — `isFederatedEntry`, `isMountableDefinition`, `FederatedRegistryEntry`, `MountableDefinition`, `MountContext`, `KIND_ATTRIBUTE`, `MOUNT_ATTRIBUTE`, `OVERLAY_ROOT_ATTRIBUTE`, `SCOPE_ATTRIBUTE` and `createOverlayRoot`. Import them from `@company/mfe-react/host`, matching `@company/mfe-angular`, so a name a shell needs has exactly one import path across adapters. `createContainerTransport`, `installShellAuth` and their types stay on the root: the generated `#mfe/fetch` module imports them from there.
