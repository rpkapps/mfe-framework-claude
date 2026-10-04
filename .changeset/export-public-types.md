---
'@company/mfe-core': patch
'@company/mfe-runtime': patch
'@company/mfe-react': patch
'@company/mfe-angular': patch
'@company/mfe-build': patch
'@company/mfe-agent': patch
'@company/mfe-rspack': patch
---

Every type a public signature names can now be imported from the package that exports the signature, so nothing needs `@company/mfe-core`. The core's public API is one list, the new `@company/mfe-core/public` entry, and `@company/mfe-react`, `@company/mfe-angular` and `@company/mfe-runtime` (and through it the adapters' `/host` entries) each re-export all of it. Both adapters therefore offer the same core types and values, now including types their signatures named but they did not export, such as `MfeError`, `Unsubscribe`, `DefinitionKind`, `RegistryEntry`, `NavigationBridge`, `ShellState`, the storage, agent and action types, and `ContractEmitPayloads`, `ContractInputs` and `ContractParsedInputs`. The Angular adapter also gains the few core values only the React adapter re-exported, such as `outputNameToHandlerProp`. `@company/mfe-build` re-exports the core descriptor and schema types it names, `@company/mfe-agent/actions` exports `ActionApprover`, `AgentContextStore` and every type they name, such as `ApprovalRequest`, `AgentTurnContext` and `DiagnosticsHub`, `@company/mfe-rspack` exports `ContainerOptions`, and `@company/mfe-rspack/env` exports `StringTransform`. The added `@company/mfe-build`, `@company/mfe-agent` and `@company/mfe-rspack` exports are type-only. `@company/mfe-core`'s package description now says it is internal and not to be imported.
