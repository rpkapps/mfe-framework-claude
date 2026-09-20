---
'@company/mfe-core': minor
'@company/mfe-host': minor
'@company/mfe-react': minor
'@company/mfe-devtools': patch
'@company/mfe-legacy-angular': patch
---

What a host can read off the registry without importing a container: a Widget's
inputs and events, an App's capability pages, and the build an entry came from.

- **`describeWidgetInputs(contract)`** in `@company/mfe-core`, re-exported from
  `@company/mfe-react`, with `defaultInputsFor`, `coerceInputs`,
  `needsInputPrompt` and the `WidgetInputField`, `WidgetInputType` and
  `WidgetInputKind` types. `null` means "the build could not describe this" and
  `[]` means "this Widget takes nothing". Nothing here validates — the provider
  still parses every input, and `coerceInputs` leaves a value it cannot convert
  as it was rather than producing `NaN`.
- **`DynamicWidget` takes `onEvent?: (name: string, payload: unknown) => void`**,
  routed by the events the provider declares. The `onX` props are unchanged and
  an event with both reaches both; `eventNameToHandlerProp` is exported for a
  host that wants one named prop. An event literally named `event` has no `onX`
  prop and still arrives through the catch-all. `lazyWidget` takes no `onEvent`.
- **`capabilityRoute(entry, name)`** in `@company/mfe-host` resolves an App's
  capability page from the registry, `undefined` when it advertises none.
  `selectReleaseNotesRoute` composes over it, unchanged in signature and result.
- **`BuildProvenance` (`hash`, `time`) on `NeutralRegistryEntry.build`.** Both
  fields are optional and neither gates loading: a `build` that does not
  validate is dropped and the entry still loads. A registry builder copies it
  from the container descriptor onto every entry that descriptor exports.

`@company/mfe-devtools` lists an entry's inputs through `describeWidgetInputs`.
