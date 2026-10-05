---
'@company/mfe-build': minor
'@company/mfe-rspack': minor
'@company/mfe-nx': minor
'@company/mfe-core': minor
---

A container's `mfe-registry.json` now holds the registry entries a shell reads, one per App or Widget, so a shell repository assembles its registry from any container repository without translating anything.

**`@company/mfe-build`, `@company/mfe-rspack`, `@company/mfe-nx`**

- **Breaking:** `mfe-registry.json` is an array of entries rather than one container record. Each entry carries `id`, `kind`, `mfe.framework`, `manifestUrl`, `container`, `expose`, `shareScopes` and `requiresRuntime`, plus the definition's `version`, `capabilities`, `routes`, `contract`, `title`, `description`, `tags` and `icon` and the container's `build` when there are any. `manifestUrl` stays relative to the file: resolve it against the URL the file was deployed at, apply any shell-owned presentation overrides, and add the entries to the registry unchanged. A file written by an earlier build is an object; rebuild its container. The Module Federation manifest's `metaData.mfe` and `GeneratedOutput.descriptor` are unchanged.

**`@company/mfe-core`**

- `PublishedRegistryEntry` is new: the type of one entry in `mfe-registry.json`.
