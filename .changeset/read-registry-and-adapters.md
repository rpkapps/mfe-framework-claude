---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-legacy-angular': minor
'@company/mfe-devtools': minor
---

Reading the registry is one function and one adapter interface, and each adapter now lives in its own package.

Exactly one adapter must recognise an entry. If none does, the entry is rejected as unrecognised. If two or more do, it is rejected as ambiguous and the reason names both. There is no order to register adapters in, and no first-match-wins rule.

**`@company/mfe-core`**

- `MfeAdapter<K, E>` is new: `kind`, `detect(raw)`, `parse(raw)` and `is(entry)`. It replaces `AdapterSelectionRule`, whose `adapter`, `advertises` and `normalize` are gone.
- `NeutralRegistryEntry` is now `RegistryEntry`, `NormalizedRegistry` is now `Registry`, and `QuarantinedRegistryEntry` is now `RejectedRegistryEntry`.
- `Registry.quarantined` is now `Registry.rejected`.
- **Breaking:** `RegistryEntry.adapterData` is gone. An adapter's own fields are typed on its own entry type and reached through its `is()` guard.
- **Breaking:** `AdapterKind` is gone. `entry.adapter` is a `string` that each adapter declares, and the core no longer names any adapter.
- **Breaking:** the error code `registry/invalid-descriptor` is now `registry/invalid-entry`.

**`@company/mfe-runtime`**

- `readRegistry(raw, { adapters, overrides })` replaces `normalizeRegistry(sources, { rules, overrides })`. `NormalizeRegistryOptions` is now `ReadRegistryOptions`, and `rules` is now `adapters`.
- **Breaking:** `createMfeContractRule` is gone. The React adapter moved to `@company/mfe-react`, so this package knows the adapter interface and no adapter.

**`@company/mfe-react`**

- `reactAdapter` is new, an `MfeAdapter<'react', ReactRegistryEntry>`. `ReactRegistryEntry` carries `container` and `expose` as typed fields. Its `parse` validates with zod and still reports `contract/unsupported-major` for a framework major the shell cannot load.
- `createMfeRuntime({ adapters })` replaces `createMfeRuntime({ rules })`. `reactAdapter` is always registered, and `adapters` names the extras.
- `MfeAdapter`, `Registry`, `RegistryEntry` and `RejectedRegistryEntry` are re-exported for a shell author; `AdapterSelectionRule` is not.

**`@company/mfe-legacy-angular`**

- `legacyAngularAdapter` replaces `createLegacyAdapterRule()`. Register it with `createMfeRuntime({ adapters: [legacyAngularAdapter] })`.
- **Breaking:** `readLegacyAdapterData` and `LegacyAdapterData` are gone. The legacy fields — `containerName`, `exposeName`, `navigationOwnership`, `onboardingType`, `categories`, `externalUrl`, `routes`, `settingsRoutes` — are typed on `LegacyRegistryEntry` and read after `legacyAngularAdapter.is(entry)`. `tags` is now the common `RegistryEntry.tags`.
- `deriveLegacyDefinitionId` is now exported from the package root.

**`@company/mfe-devtools`**

- The registry view reads `registry.rejected`. Its behaviour is unchanged.
