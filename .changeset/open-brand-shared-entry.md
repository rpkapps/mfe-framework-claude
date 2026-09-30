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
- `BrandedDefinition.requiresRuntime` and `ContainerDescriptor.requiresRuntime` are required. The definition helpers and build integrations write the same framework requirement.

**`@company/mfe-runtime`**

- `parseFederatedEntry(raw, adapter)` is new. It checks the entry's generated `requiresRuntime` range before reading a federation entry with Zod, and stamps the adapter kind the caller passes. The same `apiVersion`/`requiresRuntime` contract covers the registry format, mount protocol and runtime services. Missing or malformed requirements report `registry/invalid-entry`.

**`@company/mfe-react`, `@company/mfe-angular`**

- `reactAdapter.parse` and `angularAdapter.parse` both use `parseFederatedEntry`, replacing the two copies of the schema. Each adapter keeps its own framework-marker `detect` rule. Runtime incompatibility is reported before registry shape validation.

**`@company/mfe-build`**

- `ContainerProfile.framework` and `FrameworkManifestMetadata.framework` are typed as `string`.
