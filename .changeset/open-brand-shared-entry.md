---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': patch
'@company/mfe-angular': patch
'@company/mfe-build': patch
---

Any adapter can brand its definitions, and the entry shape every framework build publishes is read in one place.

**`@company/mfe-core`**

- **Breaking:** `BrandedDefinition.framework` is any non-empty string, and `DefinitionFramework` is gone. `isBrandedDefinition` now accepts a definition from an adapter that neither the core nor the runtime names, so a further adapter plugs in without changing either. `ContainerDescriptor.framework` is a `string` as well.

**`@company/mfe-runtime`**

- `parseFederatedEntry(raw, adapter)` is new. It checks the generated runtime requirement before reading a federation entry with zod, and stamps the adapter kind the caller passes. The same `apiVersion`/`requiresRuntime` contract covers the registry format, mount protocol and runtime services.

**`@company/mfe-react`, `@company/mfe-angular`**

- `reactAdapter.parse` and `angularAdapter.parse` both use `parseFederatedEntry`, replacing the two copies of the schema. Each adapter keeps its own framework-marker `detect` rule. Runtime incompatibility is reported before registry shape validation.

**`@company/mfe-build`**

- `ContainerProfile.framework` and `FrameworkManifestMetadata.framework` are typed as `string`.
