---
'@company/mfe-runtime': minor
'@company/mfe-react': patch
'@company/mfe-angular': minor
---

The provider's half of the Widget boundary is written once, in the runtime, and an Angular Widget now fails on a reserved input name exactly as a React Widget does.

- **`validateProviderInputs(definition, inputs)`** is new in `@company/mfe-runtime`. It checks serializability, then the Widget's own inputs schema, then the names the schema produced. It answers `accepted` with the parsed value, `rejected` for a set that breaks the contract, or `misdeclared` for a contract that produces a name a host reserves (`key`, `ref`, `fallback` or `onX`), which no later set can repair.
- **`createProviderEmit(definition, deliver)`** is new in `@company/mfe-runtime`: the one validating emit, throwing at the call site for an undeclared event, a payload JSON cannot carry, or one the Widget's event schema refuses. Both adapters build their Widget emit with it. `ProviderDefinition` and `ProviderInputs` name its types.
- **Behaviour change, `@company/mfe-angular`:** a reserved input name is a failure of the mount rather than a rejected set. On the first inputs, `mount()` rejects, so the mount reaches its `error` state and `<mfe-widget>` shows its fallback path and emits `(failed)`, as before. On a later update it now goes to `target.onFailure`, so the mount moves to `error` and is torn down, where it used to report the set through `onInputRejected` and keep the last valid inputs. The error is the React adapter's, code `contract/input-mismatch`, with the same message and repair, and without the definition's version.
- `@company/mfe-react` behaves as before; it now calls the runtime's checks instead of its own copy.
