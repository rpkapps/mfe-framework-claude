---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
'@company/mfe-build': minor
'@company/mfe-rspack': patch
---

A shell refuses a container it cannot read or mount, a failed load can be retried, and a Widget's failure stays in its own region.

- **Breaking:** removed `contractMajor` and `contract/unsupported-major`. One `apiVersion`/`requiresRuntime` contract covers the registry format, mount protocol and runtime services. Incompatible runtime requirements are refused before adapter selection or registry shape parsing. The framework marker and widget schema checks remain.
- **Breaking:** entries and definitions must declare `requiresRuntime`, and runtimes must declare `apiVersion`. Generated entries and definitions use the same framework requirement, currently `'>=1.1.0 <2.0.0'`; `ContainerProfile.requiresRuntime` is removed. Missing metadata is an error. Shells check before download; adapters check again before mounting. Package versions do not set this version.
- Shared loads stop at the configured deadline and are dropped. Retry starts a new load; a late result cannot replace it. Federation errors that need a page reload are distinguished from manifest failures that can be retried.
- Changing the user or groups cancels and clears React mount queries, replaces their QueryClient and starts the App router again. Angular Apps destroy their application and mount again at the current URL, creating fresh providers, router and components. Component and form state resets; stored preferences stay. Angular cancels intercepted requests from the previous session. Widgets can use `injectSession()` to fetch their own data again.
- Widget hosts expose rejected-update callbacks and accepted/rejected input state independently of mount state. The last valid view remains. React shows a stale-input message, replaceable with `inputFallback`, and calls `onInputRejected`. Angular emits `inputRejected` and renders only the consumer's `inputFallback` template. Valid updates clear the rejection.
- **Breaking:** a Widget mount request takes the whole `consumerContract`; `consumerOutputs` is gone. Before mounting, the host checks that the loaded Widget declares every output name the consumer expects. Zod validates the actual inputs on mount and update, then each emitted payload against the Widget's schema and the consumer's schema. Input types, bounds and other schema rules are not compared before mounting. The runtime requirement applies to both Apps and Widgets; the output-name check applies only to Widgets.
- **Breaking:** `MountedWidget.update(inputs)` returns `WidgetUpdateResult`: `{ status: 'accepted' }` or `{ status: 'rejected', error }`. Validation and the result are synchronous. A rejected update keeps the previous view. The runtime reports it to the host's `onInputRejected`; providers no longer receive that callback on their mount target. Reserved input names remain declaration failures and throw. `WidgetDefinitionMount.update` still returns nothing.
- React hosts show loading and error content by default, with Retry or Reload page as the failure requires. Fallback callbacks receive `reload` as well as `error` and `retry`. Angular hosts supply state and actions, and render only consumer pending/fallback templates; they add no presentation markup or styles. Fallback templates receive the error, retry, reload, recovery kind and attempt. Errors are reported even without a template.
- Two copies of a Widget can keep separate preferences: give each an `instanceId` and declare the key with `storedKey(name, schema, { perInstance: true })`. One value per app stays the default; existing keys are unchanged. A `perInstance` key without a non-empty host ID fails.

The host prop names `instanceId`, `inputFallback`, and `onInputRejected` are reserved; output names that collide with host handler props are rejected. Toast behavior remains unchanged.
