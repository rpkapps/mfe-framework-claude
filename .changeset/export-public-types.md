---
'@company/mfe-core': patch
'@company/mfe-runtime': patch
'@company/mfe-react': patch
'@company/mfe-angular': patch
'@company/mfe-build': patch
'@company/mfe-agent': patch
'@company/mfe-rspack': patch
---

Every type a public signature names can now be imported from the package that exports the signature, so nothing needs `@company/mfe-core`. `@company/mfe-runtime`, and through it the adapters' `/host` entries, re-export the core types its API uses, such as `MfeError`, `Unsubscribe`, `DefinitionKind`, `RegistryEntry`, `NavigationBridge`, `ShellState` and the storage, agent and action types. `@company/mfe-react` exports `ContractEmitPayloads`, `ContractInputs` and `ContractParsedInputs`, and `@company/mfe-angular` exports `ContractEmitPayloads`. `@company/mfe-build` re-exports the core descriptor and schema types it names, `@company/mfe-agent/actions` exports `ActionApprover` and `AgentContextStore`, `@company/mfe-rspack` exports `ContainerOptions`, and `@company/mfe-rspack/env` exports `StringTransform`. All are type-only exports. `@company/mfe-core`'s package description now says it is internal and not to be imported.
