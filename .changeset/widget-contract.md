---
'@company/mfe-core': minor
'@company/mfe-host': minor
'@company/mfe-react': minor
'@company/mfe-devtools': patch
'@company/mfe-legacy-angular': patch
---

What a host can read off the registry without importing a container: a Widget's inputs and events, an App's capability pages, and the build an entry came from.

- `describeWidgetInputs(contract)` (in `@company/mfe-core`, re-exported from `@company/mfe-react`), with `defaultInputsFor`, `coerceInputs`, `needsInputPrompt`, `WidgetInputField`, `WidgetInputType` and `WidgetInputKind`; `null` means the build could not describe the Widget, `[]` means it takes nothing.
- `DynamicWidget` takes `onEvent?: (name: string, payload: unknown) => void`, routed by the provider's declared events alongside the unchanged `onX` props; `eventNameToHandlerProp` is exported for a host that wants one named prop. `lazyWidget` takes no `onEvent`.
- `capabilityRoute(entry, name)` (in `@company/mfe-host`) resolves an App's capability page, `undefined` when it advertises none.
- `BuildProvenance` (`hash`, `time`), optional and never gating, on `NeutralRegistryEntry.build`.

`@company/mfe-devtools` now lists an entry's inputs through `describeWidgetInputs`.
