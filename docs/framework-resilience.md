# Loading separately deployed containers

A container can deploy without the shell. A tab reads its registry once, so it may load container
code newer than the code it started with. The framework checks the entry and the loaded definition
before mounting. A failure costs the page that App or Widget; the rest keeps running.

## Which shell can load you

The build writes the runtime requirement. Container authors do not set it themselves:

```json
{ "requiresRuntime": ">=1.1.0 <2.0.0" }
```

The shell advertises `runtime.apiVersion`, currently `"1.1.0"`. This one version covers the registry
format, mount protocol and shell-owned services. The shell checks the requirement before choosing
an adapter or reading the entry's shape. It still checks the framework marker and Widget schemas
once the versions agree. There is no separate registry-format version.

The loaded definition is checked again before mounting, because a container can change after the
registry was written. React and Angular adapters check too, so a newer container still refuses a
shell that has no check of its own. Missing `requiresRuntime` uses `>=1.0.0 <2.0.0`; a runtime without
`apiVersion` reads as `1.0.0`.

A backward-compatible change to the format, mount protocol or services raises the API minor. An
incompatible change raises its major. Package versions are separate: loading a newer runtime
package cannot replace the object the shell already created.

The generated range uses stable SemVer comparators: `>=`, `>`, `<=`, `<`, `=` or an exact version,
joined with spaces. There is no space between an operator and its version. Build metadata does
not change the comparison. Prereleases, caret/tilde ranges, wildcards and alternatives are not
accepted. This small reader needs no npm SemVer dependency in the browser.

## When a load fails

Every shared load runs under `runtime.deadlines.load`, 30 seconds by default. A failed or timed-out
load is dropped, so Retry starts again. If two Widgets are waiting on the same container, removing
one does not cancel the other's load. A result arriving after the deadline is ignored. Preloads
and Angular page assets have deadlines too.

Module Federation can keep a failed or unfinished entry load after the framework stops waiting.
Clearing the whole container could break definitions that already use it. In that case the error
is `load/reload-required`, and the host can offer Reload page. A failed manifest fetch can still be
retried when the federation runtime has dropped it. Nothing retries automatically.

A chunk removed by deployment cannot be recovered by this tab. Save your work and reload.

## When the user or groups change

React cancels and clears each mount's queries, replaces its QueryClient, and starts the App router
again. The Widget or route renders for the new user. Component state inside the mount resets;
stored preferences stay. A query still holding the old client cannot fill the new client's cache.
A theme change does none of this.

Angular reruns the current route's guards and resolvers, hiding the old route while they run.
A refused route refresh fails inside that App's region. The framework HTTP interceptor cancels
requests started for the previous session and drops their responses.

For a Widget or service that fetches its own data, use Angular's `injectSession()`. It returns a
signal with `{ generation, signal }`. Observe `generation` to fetch again, and pass `signal` to
work that should stop when the session changes. Caches and requests you create yourself must
follow that signal; the framework can clear only what it owns.

## When Widget inputs are refused

Invalid first inputs fail the mount. Invalid later inputs leave the Widget showing its last valid
inputs. A React host shows a message saying the update was refused. A valid update removes it.

React's `lazyWidget` and `DynamicWidget` take `onInputRejected(error)` and
`inputFallback({ error })`. Angular's `<mfe-widget>` emits `(inputRejected)` and accepts an
`[inputFallback]` template. Its `inputStatus()` and `inputError()` say whether the last update was
accepted while `status()` still says `mounted`. Angular renders a rejection message only when
the consumer supplies that template.

Import a Widget's contract in its consumer to check more than the current values. Before mounting,
the framework compares what the consumer can send with what the Widget takes, and what the Widget
can emit with what the consumer handles. Adding a required input or removing an expected output
can then fail before the Widget renders. See [Widget contract compatibility](./widget-contract-compatibility.md)
for the changes the checker can compare.

## What the host shows

React App and Widget hosts show loading and error content by default. A temporary failure offers Retry.
Invalid first inputs ask you to correct them, then retry. Incompatible versions or an unavailable
chunk offer Reload page. Expand Details for the definition, version, operation and attempt.
Diagnostics also name the container.

Replace React's `pending`, `fallback` or `inputFallback` to use the host's own presentation.
`fallback` receives `{ error, retry, reload }`.
The mount element stays in place through a retry, and a rejected input update does not remove a
working Widget.

Angular hosts supply the state and actions, and render only the consumer's `[pending]`, `[fallback]`
and `[inputFallback]` templates. A fallback receives the error, retry, reload, recovery kind and
attempt. Declare it in the consuming component; its content uses that component's Angular style
scope. See the [Angular host example](../packages/mfe-angular/README.md#hosting-definitions-from-angular).

Without a fallback template an Angular failure leaves an empty region. `(failed)` still emits and
diagnostics still report it. A rejected update emits `(inputRejected)` and keeps the last valid
view; without `inputFallback`, no message is added. The adapter supplies no presentation markup
or styles.

## Give each copy its own preferences

Two copies of a Widget share stored preferences by default. To keep separate preferences, the
host gives each copy an `instanceId`:

```tsx
<DynamicWidget widgetId="well-view" instanceId="dashboard-east-well" />
```

Inside the Widget, pass `{ scope: 'instance' }` to `useStoredState`, `injectStoredState` or a storage
key operation. Use the same ID when the tile returns after a reload. A new ID starts a separate
record; reusing an ID shares it. Instance storage without a non-empty host ID fails with
`storage/failure`. Omitting `scope` keeps the definition-wide record.

## Tests and bundle size

Tests cover older and newer shells, failed and hung loads, late results, changed Widget contracts,
refused inputs, user changes and separate Widget preferences. Integration tests use the actual
Module Federation runtime and place React and Angular definitions in each other's hosts.

No production dependency was added. The federation test dependency stays in the integration-test
package, the compatibility checks use small local readers, and React's default host content uses
native HTML elements. Angular's host content comes from the consuming component's templates.

### Framework code measurements

Compared with `ab4f2d1`, using esbuild 0.28.2, production branches, ES2022 ESM, all exported APIs, minification and gzip level 9:

| Entry         | Before gzip bytes | After gzip bytes |  Delta |
| ------------- | ----------------: | ---------------: | -----: |
| `mfe-core`    |             5,144 |            8,065 | +2,921 |
| `mfe-runtime` |            36,834 |           41,382 | +4,548 |
| `mfe-react`   |            23,664 |           28,043 | +4,379 |
| `mfe-angular` |            25,391 |           30,725 | +5,334 |

These figures bundle the framework code with third-party packages kept external. The runtime
and adapters include core/runtime code, so the rows overlap: do not add them. What a page downloads
depends on the APIs it imports and how its containers share packages. The standalone contract
checker is approximately 2.56 KB gzip.

Reproduce with `node tools/bundles/measure-framework.mjs` and the same command pointing at a baseline checkout. The script uses the existing design-system build's esbuild dependency; it adds no dependency to the framework.
