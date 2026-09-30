# Framework resilience for independent containers

Containers can be deployed separately while the shell keeps its registry fixed for a browser session. The framework checks what it can before creating an application and contains failures to the affected feature. Assets removed by deployment cannot be recreated by the framework; reload remains the recovery action for an unavailable chunk.

## Shell runtime API

The shell-owned object advertises `apiVersion: '1.1.0'`. The build generates `requiresRuntime: '>=1.1.0 <2.0.0'` in container metadata and registry entries; the adapters stamp it onto definitions. Package version selection and this object contract are separate concerns: another copy of a runtime package cannot upgrade the object the shell created.

New shells reject unsatisfied registry requirements before downloading and check the loaded definition again before mounting, covering stale registry metadata. New adapters also guard before mounting, so an older shell without a preflight treats its missing API version as `1.0.0` and fails locally. Entries without requirements use the historical `>=1.0.0 <2.0.0` requirement. The guard's subpath is bundled into the adapter rather than replaced by an older shared core.

Requirements use a small generated subset of SemVer ranges: whitespace-separated `>=`, `>`, `<=`, `<`, `=` or exact stable versions. Build metadata does not affect precedence. Prereleases, caret/tilde shorthand, wildcards and range unions are deliberately unsupported; malformed metadata is rejected. There is no browser dependency on the npm SemVer parser. API additions raise the minor baseline; incompatible API changes raise the major.

## Shared loading and recovery

Underlying shared attempts have their own deadline, using `runtime.deadlines.load`. Disposal stops one caller waiting without cancelling callers that still need the same attempt. Failure and timeout evict it; expired results cannot populate the cache or remove a newer attempt. Preloads are bounded too. Adapter load hooks receive the shared attempt signal so their evaluation guards are released at expiry. Angular page assets also receive a signal, use an independent default 30-second deadline, and evict expired attempts without letting old completions overwrite newer attempts.

The actual Module Federation runtime can cache a rejected or pending remote entry independently. Manifest-fetch rejections can be retried. Cached entry failures and expired federation attempts become `load/reload-required`. Force-removing a container could affect definitions already using it, so recovery surfaces offer a reload instead. Automatic retries are not introduced.

## User and permission changes

React mount-owned QueryClients are cancelled, cleared and replaced on identity or group transitions. The provider subtree and App router are recreated for the new security generation. Queries and callbacks holding retired clients cannot populate the next session's visible cache. Temporary component state inside that subtree resets; persistent preferences remain. Theme changes do not trigger this reset.

Angular Apps reload the current route's guards and resolvers on these transitions and hide the previous route view while refresh is pending. A rejected refresh fails within the App boundary. Mount-owned `injectSession()` returns a signal containing `{ generation, signal }`; a prior session's abort signal retires at the transition. Widgets and services can observe the generation to reload their own data. The framework HTTP auth interceptor cancels and suppresses intercepted old-session responses. Arbitrary author-owned caches and requests still need to follow the session signal.

## Widget inputs and contracts

An initial invalid input remains a mount failure. A later invalid update preserves the last valid view and changes input status to `rejected`, independently of mounted status. React `lazyWidget` and `DynamicWidget` accept `onInputRejected` and `inputFallback`. Angular `<mfe-widget>` emits `inputRejected` and exposes input state/status/error signals and an `inputFallback` template. A valid update clears the indication, including returning to the prior valid inputs.

A typed consumer supplies its complete contract. Before the provider creates its UI, the framework checks consumer inputs against provider acceptance and provider outputs against consumer acceptance. New required inputs, removed expected outputs, and supported schema narrowing are detected. Optional input and additional output extensions are accepted where their schemas permit them.

The schema checker compares a supported JSON Schema subset and locally projects supported Zod 4 metadata without executing schema callbacks. Custom refinements, transforms, lazy schemas and unfamiliar constraints can produce `unknown`. Unknown results are diagnostics rather than compatibility promises; provider and consumer payload validation still run. Dynamic consumers without contracts retain actual-input validation but cannot infer outputs application code expects.

## Local host surfaces

React and Angular App/Widget hosts provide loading and error content by default. Temporary failures offer retry, initial input failures ask for corrected inputs before retry, and runtime/contract/federation incompatibilities explain the mismatch and offer reload. Default details include definition, version, operation and attempt; diagnostics retain the full structured error. Hosts can override pending, fatal error and rejected-input presentations.

## Instance preferences

Definition storage remains the default. For separate copies, supply a stable host ID:

```tsx
<DynamicWidget widgetId="well-view" instanceId="dashboard-east-well" />
```

Authors opt in with `{ scope: 'instance' }` on `useStoredState`, `injectStoredState`, or imperative storage key operations. The namespace contains the definition and stable instance ID, with length-prefix encoding that avoids collisions with legacy keys. It survives remounting and isolates different instances. Missing or invalid stable IDs produce an error for instance storage. The transient mount token is never used for persisted identity.

## Verification and bundle scope

Focused tests cover deadlines, abandoned callers, late results, mixed runtime versions, schema changes, input rejection/recovery, identity changes, and stable instance storage. Integration tests exercise the actual Module Federation runtime and React/Angular host-provider boundaries.

No new production dependencies are required. The federation test dependency belongs to the integration-test package. Browser compatibility checks reuse small local helpers, and host defaults use native semantic elements rather than introducing a UI library.

### Framework code measurements

Compared with `ab4f2d1`, using esbuild 0.28.2, production branches, ES2022 ESM, all exported APIs, minification and gzip level 9:

| Entry         | Before gzip bytes | After gzip bytes |  Delta |
| ------------- | ----------------: | ---------------: | -----: |
| `mfe-core`    |             5,144 |            8,123 | +2,979 |
| `mfe-runtime` |            36,834 |           41,435 | +4,601 |
| `mfe-react`   |            23,664 |           28,134 | +4,470 |
| `mfe-angular` |            25,391 |           31,548 | +6,157 |

These are conservative framework-code bundles. Third-party dependencies are external, and workspace core/runtime code is included in downstream entries, so rows overlap and must not be summed. Actual application transfer size depends on federation sharing and used APIs. The standalone contract checker is approximately 2.56 KB gzip.

Reproduce with `node tools/bundles/measure-framework.mjs` and the same command pointing at a baseline checkout. The script uses the existing design-system build's esbuild dependency; it adds no dependency to the framework.
