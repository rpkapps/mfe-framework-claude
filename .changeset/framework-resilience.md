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
- Generated entries and definitions declare `requiresRuntime: '>=1.1.0 <2.0.0'`. Shells check it before download; adapters check again before mounting. Missing requirements use the original 1.0.0 API baseline. Package versions do not set this version.
- Shared loads stop at the configured deadline and are dropped. Retry starts a new load; a late result cannot replace it. Federation errors that need a page reload are distinguished from manifest failures that can be retried.
- Changing the user or groups cancels and clears React mount queries, replaces their QueryClient and starts the App router again. Component state resets; stored preferences stay. Angular reruns route guards/resolvers and cancels intercepted requests from the previous session. Widgets can use `injectSession()` to fetch their own data again.
- Widget hosts expose rejected-update callbacks and accepted/rejected input state independently of mount state. The last valid view remains. React shows a stale-input message, replaceable with `inputFallback`, and calls `onInputRejected`. Angular emits `inputRejected` and renders only the consumer's `inputFallback` template. Valid updates clear the rejection.
- A consumer that imports a Widget's contract is checked against the loaded Widget before it renders. Changed required inputs or missing outputs fail that mount. Constraints the checker cannot compare are reported as `unknown`; input and output values are still validated.
- React hosts show loading and error content by default, with Retry or Reload page as the failure requires. Fallback callbacks receive `reload` as well as `error` and `retry`. Angular hosts supply state and actions, and render only consumer pending/fallback templates; they add no presentation markup or styles. Fallback templates receive the error, retry, reload, recovery kind and attempt. Errors are reported even without a template.
- Two copies of a Widget can keep separate preferences: give each an `instanceId` and pass `{ scope: 'instance' }` to stored state or storage key operations. Definition scope stays the default; existing keys are unchanged. Instance storage without a non-empty host ID fails.

The host prop names `instanceId`, `inputFallback`, and `onInputRejected` are reserved; output names that collide with host handler props are rejected. Toast behavior remains unchanged.
