# Architecture decisions and findings

Each entry records a decision that was forced by evidence rather than taste, so
a future maintainer can tell which constraints are real and which are
preferences. Where a gate produced an uncomfortable answer, the uncomfortable
answer is recorded rather than smoothed over.

---

## 1. The boundary history is built by hand, because `createBrowserHistory` patches globals

**Status:** decided, load-bearing.

TanStack's `createBrowserHistory()` reassigns `window.history.pushState` and
`window.history.replaceState` so it can observe navigations it did not perform,
restoring them on `destroy()`. Verified directly in the pinned
`@tanstack/history` build.

That is precisely the global History patch this framework exists to remove. It
is action at a distance, it breaks anything else that wraps those methods, and
with several routers on one page it is what makes two routers fight over the
URL.

`createHistory()` is the supported seam for supplying a different backing store,
so `packages/mfe-react/src/boundary-history.ts` builds each App's boundary
history over the explicit navigation bridge instead.

Building one by hand means supplying what `createBrowserHistory` would have.
Three of those were missing, and all three failed silently:

- **The blocker store.** `createHistory` consults `getBlockers` on every push
  and replace, and `block()` returns a no-op unless it is also given
  `setBlockers`. Without the pair, `useBlocker` inside an App registered
  successfully and was never asked anything. The history now owns the array,
  and hands it back through `getBlockers()` so the host can put the _shell's_
  navigations to the same blockers — see decision 20.
- **The entry state.** The bridge an App's history is built over is
  `runtime.navigator`, whose `push`/`replace` took only a path. Every entry an
  App pushed therefore had `history.state === null`, so neither the App's
  history nor the shell's could compute a position delta: a browser back was
  classified as a `GO` of zero, and a refused one had nothing to roll back by.
  The navigator now forwards `state` and exposes `readState` and `go`.
- **A subscription that did not survive a remount.** The history subscribed to
  the bridge from its constructor, which ran in a `useMemo`, and unsubscribed
  from an effect cleanup. React runs cleanup and setup again without re-running
  the memo — decision 14, the same pairing, a different object — so from the
  first remount the App's router was never told the URL had moved: browser back
  and forward changed the address bar and left the page where it was.
  Construction is now pure and `attach()` is what listens, owned by the effect
  that ends it.

**Consequence:** the framework never calls `createBrowserHistory`, and a
contributor who reaches for it reintroduces the banned patch. The `mfe/no-global-patching`
lint rule catches direct patching but cannot catch this, so it is written down here.
The price of the hand-built history is that every capability it should have is
ours to supply, and a missing one does not announce itself —
`packages/mfe-react/src/boundary-history.test.ts` pins the three found so far.

---

## 2. One generated route tree can back two concurrent mounts

**Status:** proven against the pinned versions; kept as a regression test.

The design depends on `routeTree.gen.ts` being a description rather than an
instance, so one statically imported tree can back every mount of an App —
including two concurrent mounts at different boundaries.

Tested in `packages/mfe-react/src/tracer-bullet.test.tsx`: two routers built
from one tree keep independent histories, independent locations and independent
matches. Navigating one does not move the other.

**Consequence:** no tree-cloning remedy is needed and the author's factory
contract did not have to change. If a future router version breaks this, the
test fails before anything else does.

---

## 3. The pinned router exposes enough state to validate the entry contract

**Status:** proven.

Mount-time validation needs to see what the author's factory actually built.
`router.options.basepath` and `router.history` are both observable supported
state, and `router.history === suppliedHistory` is an exact identity check.

**Consequence:** an App that ignores the supplied `basePath` or substitutes its
own history fails explicitly at mount with a message naming the one-line repair,
rather than rendering at the wrong boundary and surfacing much later.

---

## 4. Browser async context does not propagate across `await`, and we do not pretend it does

**Status:** honest limitation, documented in code and tests.

Trace parentage is maintained by a synchronous active-span slot with explicit
capture. What that supports and what it does not:

**Supported:** nested active spans to any depth; a span created synchronously
inside an active callback; the synchronous prologue of an async callback;
restoration after a callback returns or throws; two mounts interleaved without
leaking context into each other; each `Promise.all` operation's synchronous
region parented to its own span; continuations explicitly wrapped with
`bindTelemetryContext`.

**Not supported:** a span created _after_ an `await` inside an active callback.
It becomes a root with a fresh trace id.

The decision that matters is the failure mode: an unsupported case produces **no
parent**, never a wrong one. A wrong parent is worse than a missing one, because
it silently corrupts the trace tree and nobody notices.

`node:async_hooks` was deliberately not used: it would make correlation pass in
the Node test runner and fail in browsers, which is the worst of both.

---

## 5. The browser support matrix was removed

**Status:** decided, at the project owner's direction.

A tool here measured aggregate global usage coverage for the feature set the
framework depends on, against a 91% target, and failed: **89.9685%** with
caniuse-lite 1.0.30001810. Native CSS `@scope` was the entire gap — the same
intersection without it measured 95.6886% — and the shortfall was mainstream
users on pre-`@scope` releases rather than exotic browsers.

The owner removed it rather than tune it. That is a reasonable call: the number
was a policy input, not a build check, and a tool that recomputes a policy
target on every CI run invites the target to be edited until it passes.

What is worth keeping from it: `@scope` is still the feature with the narrowest
support of anything the framework requires, and `packages/mfe-rspack/src/css/`
still emits it with no fallback. A deployment whose audience includes Chrome
below 118, Firefox below 146 or iOS Safari below 17.4 will see unscoped CSS.
That is now a thing to know rather than a gate to pass.

---

## 6. Federation lives in the React adapter, not in the neutral host

**Status:** decided.

The neutral host must not import Module Federation, but something has to load
containers. The host therefore defines a `ContainerLoader` port and the concrete
federation implementation ships from the React adapter, which already depends on
React — the strict singleton whose share scope has to resolve consistently — and
on the design system, which is not one and publishes its own sharing contract
(`@tecton/react/federation/shared`).

**Consequence:** the contract tracer bullet runs with an in-process loader, no
bundler and no network, which is what let the contract risk be retired before
the build integration existed. Federation-specific values (container name,
expose path) travel in the registry record's adapter-private payload so the
neutral shape stays free of that vocabulary.

---

## 7. Two error conditions have no exact code in the closed union

**Status:** deviation, flagged for review.

`MfeErrorCode` is a closed union and adding a code is a deliberate contract
change, so the implementation did not add one. Two conditions therefore use the
nearest available code:

| Condition                                       | Code used            | Why it is approximate                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session refresh failed                          | `config/unreachable` | The session endpoint could not deliver a usable token. This is a session-level event. The `SessionFailure` channel that used to carry a precise reason alongside it was removed when session ownership moved to the shell, so the approximate code is now the only signal the framework gives. |
| A 401 response whose request cannot be replayed | `config/invalid`     | The request as configured cannot be replayed. Nothing in the union describes replayability.                                                                                                                                                                                                    |

If these are worth naming properly, `auth/session-expired` and
`auth/not-replayable` are the natural additions, and there are exactly two call
sites to change: `failSession` in `packages/mfe-host/src/auth/session.ts` and
`warnNotReplayable` in `packages/mfe-host/src/auth/authenticated-fetch.ts`.

---

## 8. The pnpm version is not pinned

**Status:** deliberate deviation, at the user's direction.

The dependency policy asks for an exact `packageManager` pin. The project owner
asked for the latest pnpm instead, so the root manifest carries no
`packageManager` field.

Everything else in that policy stands: the lockfile is committed, CI installs
with `--frozen-lockfile`, and `pnpm-workspace.yaml` carries
`strictDepBuilds: true`, `dangerouslyAllowAllBuilds: false` and an explicit
`allowBuilds` map where each entry records why that dependency may run an
install script — including one explicit denial.

---

## 9. Legacy Angular compatibility is proven against fixtures, not the real applications

**Status:** scope limit, stated plainly.

The legacy Angular repositories are not available in this environment, and the
first slice is explicitly not allowed to require them. The legacy adapter is
therefore built and tested against production-equivalent contract fixtures and
test doubles.

What that does prove: the translation of legacy registry fields into the neutral
record, that legacy vocabulary stays out of the neutral shape, the parcel
lifecycle shape, baseHref delegation, the shell-owned route patterns, the
release-notes sibling fallback, and — most importantly — that an entry
advertising a malformed new contract is never reinterpreted as legacy.

What it does not prove: that the real Asset Tracker and Rigstream applications
mount, navigate and unmount correctly. That requires those repositories and is
the entry condition for the legacy gate, not something fixtures can substitute
for. No claim to the contrary appears anywhere in this repository.

---

## 10. The framework owns no session; the shell installs one and the container binds to it

**Status:** decided after a course correction, load-bearing.

An earlier slice had the framework implementing a session: storage, refresh,
failure events, the lot. That was wrong, and the project owner said so. A shell
already authenticates with Better Auth, Auth0 or MSAL, and a framework that
implements a second session guarantees two sources of truth for one credential.

What the framework legitimately owns is the interceptor: the token is attached
at the request boundary, only to origins the author declared `{ api: true }`,
and a replayable 401 is retried exactly once. `createSessionTokenService` stays
only as an opt-in single-flight adapter for a shell with no library of its own.
It is a convenience, not the path.

That split created a real problem. A generated `#mfe/fetch` module is evaluated
by the federation runtime with no host in scope, so the shell cannot pass it a
token source and the build cannot know one. The seam is therefore two-sided:

- `installShellAuth({ tokens })` — the shell's one call, made before any remote
  is registered.
- `createContainerTransport({ id, apiBaseUrl, apiOrigins })` — what the build
  generates, carrying only the part the build knows.

**A single host-wide session is the requirement, not a shortcut.** §10.5 makes
refresh single-flight across every mount on the page; with rotating refresh
tokens, a second concurrent refresh presents a credential the server already
retired and logs the user out. A per-mount token source would be the bug.

Resolution is deferred to the first request rather than done at module
evaluation. Binding eagerly would turn a shell wiring mistake into an
unloadable container instead of an actionable error on the request that needed
the token.

**Consequence:** the framework ships no session implementation, and
`apps/shell/src/shell/session.ts` is shell code a real deployment deletes.

---

## 11. Three failures were reported green by checks that could not see them

**Status:** finding, recorded so the class is recognised rather than the
instances.

Each of these passed every gate in this repository while being broken. None was
found by a test; all three were found by running the thing.

| Failure                                                                                                                                                                                               | Why the checks missed it                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `#mfe/fetch` imported a `createAuthenticatedFetch({ id, origins })` signature that does not exist, and a `getAccessToken` that `mfe-host` never exported                                              | The generation tests asserted on the _strings_ the generator emits, never that the emitted module resolves. Nothing type-checked generated output, because generation only ran inside a bundler. |
| `boot.tsx` read `process.env['FARO_URL']`; there is no `process` in a browser and the shell config defined nothing, so the shell threw before rendering                                               | No test boots the shell in a browser. The expression compiles, type-checks and bundles; only the runtime disagrees.                                                                              |
| Every jest-dom matcher was untyped: `@testing-library/jest-dom/vitest` augments `interface Assertion<T = any>`, but vitest 5 declares two type parameters, so declaration merging silently dropped it | TypeScript reports this at each call site, not at the import, and `mfe-react`'s `vitest.setup.ts` was not in its own tsconfig `include`, so the augmentation was never loaded to fail.           |

The shared cause is that each check measured a proxy for the thing rather than
the thing: emitted text instead of a resolving module, compilation instead of
boot, a declared dependency instead of a loaded declaration.

**Consequence:** generated output is type-checked by the example containers,
which now generate `.mfe/` without a bundler; the matcher augmentation lives in
the same file as the `expect.extend` that makes it true at runtime; and a claim
that the suite is green is not a claim that the software runs.

---

## 12. A federated page needs its own verification, because nothing else sees it

**Status:** decided after five defects in a row, load-bearing.

The first time the shell loaded a real container, five separate defects
surfaced. All five compiled, type-checked, passed the whole unit suite and, in
three cases, produced a clean production build.

| Defect                                                        | Why every other check passed                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The shell registry named containers that do not exist         | Nothing cross-checks a hand-written registry against the containers that exist. This is why the registry is now assembled from each container's own generated descriptor.                                                                  |
| Containers advertised `requiredVersion: "catalog:"`           | Omitting `requiredVersion` reads as "no requirement" but makes Module Federation infer one from `package.json`, where a pnpm workspace protocol is not a version. The unit test asserted the omission — the broken behaviour — and passed. |
| The shell rendered recursively inside every App               | `@tanstack/router-plugin` injects a development HMR shim reading `window.__TSR_ROUTER__`, and `RouterCore` publishes every router it builds there. The shim is absent from a production build, so only a dev page shows it.                |
| Every framework hook failed with "rendered outside any mount" | A second copy of the React surface is invisible to a type-checker: both copies are correct, and only one page has both.                                                                                                                    |
| Routes silently rendered nothing                              | Rspack's lazy compilation serves chunks from the dev server's own origin. A cross-origin remote's request never arrives, and nothing reports it.                                                                                           |

Three of these come from the same root assumption, held by tools the framework
does not own: **one application per page.** A shared global for "the current
router", a dev-server endpoint on "the" origin, a bundler's idea of "the"
package copy. A micro-frontend shell breaks that assumption by construction, so
every such global is a place where two mounts can be confused for one.

**Consequence:** `pnpm run verify:page` boots the shell and every container,
loads the page in a real browser, and asserts that a container mounted, that a
Widget from a _second_ container mounted inside it, that the shell chrome
appears exactly once, and that no hook reported itself outside a mount. Each
assertion is one of the defects above. A green unit suite is not evidence that
the page works, and this repository no longer claims otherwise.

---

## 13. The build integration is an Rsbuild plugin, not a bare Rspack plugin

**Status:** deliberate deviation, at the project owner's direction.

§10.7 and acceptance criterion 26 say `mfePlugin()` is a normal Rspack plugin
and that ordinary Rspack options stay ordinary. The public entry is now
`pluginMfe()`, an Rsbuild plugin, and a container's own Rspack options go under
`tools.rspack`. Rsbuild is Rspack underneath, from the same team, so this is a
change of layer rather than of engine.

**What the spec was protecting, and how it survives.** The stated objection was
to a wrapper that owns the whole config object, leaving an author with nowhere
to put an option the wrapper did not anticipate. `pluginMfe()` is still one
entry in a `plugins` array; it contributes configuration and never replaces it,
and `tools.rspack` remains an escape hatch to raw Rspack. What it owns is what
no author should write: discovery, the generated modules, scoped CSS, the
React Compiler transform and every federation setting.

**Why it was worth the deviation.** A container's configuration went from ~96
lines to ~50, most of the removal being defaults Rsbuild already has. More
importantly, declaring `moduleFederation.options` is what makes Rsbuild derive
`output.publicPath`, `output.uniqueName` and the development asset prefix for a
remote — the settings a container most often gets wrong, where the symptom is
chunks resolving against the shell's origin and no error anywhere.

**What the migration cost, and it is worth knowing.** Two things broke silently
and were caught only by building and loading a real page:

- Rsbuild replaces the federation plugin's `manifest` option when it registers
  it, so `manifest.additionalData` is never called. The framework contract
  metadata simply vanished from `mf-manifest.json`. The Rspack half now injects
  it into the emitted asset, which depends on nothing but the file existing,
  and reports an error if it does not.
- Rsbuild's default asset prefix is the serving path, `/`. For a remote that is
  the _shell's_ path, so `pluginMfe()` sets `output.assetPrefix: 'auto'`.

Both are the same shape as every other defect this repository has found: a tool
that assumes one application per page, meeting a shell that has several.

**A general hazard, worth stating separately.** Rsbuild's own federation plugin
applies its defaults in a `modifyRsbuildConfig` hook guarded on
`moduleFederation.options` already being present. A plugin's options arrive
later than that hook, so for `pluginMfe()` the guard never passes and _none_ of
those defaults are applied — silently, and only in ways that show up in a
browser. Three were missing: `server.cors`, `dev.assetPrefix`, and
`dev.client.port`, whose absence had every remote's hot-update client open a
second socket to the shell's dev server and act on the shell's rebuilds.
`pluginMfe()` therefore applies all three itself, skipping any the author set.
Relying on the documented behaviour would have been wrong in a way no test
states.

---

## 14. A mount built in `useMemo` does not survive a remount, and StrictMode remounts everything

**Status:** fixed; pinned by `packages/mfe-react/src/strict-mode.test.tsx`.

`AppHost` and `lazyWidget` built their mount in `useMemo` and disposed it in an
effect cleanup. React mounts, unmounts and mounts again without re-rendering —
StrictMode does it on every mount in development, and the same thing happens
whenever React reuses state it had previously torn down. The memo is not
re-evaluated across that, so the second setup ran against the mount the first
cleanup had disposed.

From then on the App ran on a dead mount: an aborted signal, a Query cache that
had been cleared and cancelled every query put into it afterwards, a removed
overlay root and a disposed tracer. The visible symptom was a route loader
failing with `CancelledError` in development while the same code worked in
production, which is the worst shape a defect can take.

The mount is now created by the effect that destroys it (`useOwnedMount`),
which is the pairing React supports: the same effect builds and tears down, so a
remount builds a new one. It costs one render returning nothing before the mount
exists, inside a Suspense boundary that was already showing a fallback.

A generation counter bumped from the cleanup looks like the smaller fix and is
not one. The re-render it schedules changes the memo's inputs, so the next
cleanup bumps again, and the component renders forever — which is how this was
found: the regression test hung.

**Consequence:** anything else the framework builds per mount has to follow the
same rule. "Created in a memo, destroyed in an effect" is not a safe pairing in
React 18 and later.

The boundary history was the next instance of it, found much later: it
subscribed to the navigation bridge from its constructor, in a memo, and
unsubscribed from an effect cleanup. The symptom was the same shape — correct in
production, silently broken in development — and this time it was browser back
and forward moving the URL without moving the page. The remedy is the one above:
the effect that ends the subscription is the effect that starts it.

---

## 15. A host composing the registry cannot call `lazyWidget`

**Status:** decided; `DynamicWidget` added.

`lazyWidget(id)` is documented as a module-scope call, and enforced by
`mfe/stable-definitions`, because the returned component's identity is what
React uses to decide whether it is looking at the same element: building one
during render remounts the Widget and throws its state away on every pass.

That rule is unfollowable for a host that discovers its Widgets at runtime — a
dashboard, a catalogue, a layout somebody assembled — because the ids are not
known until the registry has been fetched. Caching the components in a Map at
the call site is the obvious workaround and it is wrong twice over: it puts an
invariant the framework owns into every host that needs one, and both the lint
rule and React's own `static-components` rule read it as the defect it
resembles.

`DynamicWidget` takes the id as a prop instead. Nothing is created during
render: `lazyWidget` and `DynamicWidget` now render the same module-scope
component, which reads the id from props either way.

It is the contract-free mode by construction, and deliberately so: a typed
contract is a compile-time relationship between one consumer and one provider,
and a host that discovers its Widgets at runtime has no such relationship. The
provider still validates every input and every event payload, so the boundary is
exactly as strong — only the consumer's types are weaker, which is why the
registry publishes the input schema (§16).

---

## 16. The registry carries each Widget's contract, because a catalogue is rendered before anything is fetched

**Status:** decided; emitted by the build, validated by the host.

A host offering Widgets in a picker has to render the picker before it loads
anything. If the only way to learn what a Widget takes is to load its container,
a catalogue cannot exist — and a host that guesses the inputs gets them rejected
at the provider boundary, correctly and unhelpfully.

So the build reads each Widget's own Zod schemas statically — the same reader
that produces the runtime-config JSON Schema — and publishes them in the
container descriptor, which `tools/dev/build-registry.mjs` carries into the
registry. The shell's dashboard renders its input form from that: a select for
an enum, a switch for a boolean, defaults prefilled, required fields marked.

`inputs` is absent when the schema is not statically readable, and that is not
the same as an empty schema: a host can tell "takes nothing" from "not
published" and offer raw JSON for the second. Unlike runtime configuration, an
unreadable schema does **not** fail the build — a deployment that cannot
validate its configuration ships broken, but a Widget still mounts and still
validates its own inputs, so failing the build there would make an exotic but
correct schema unshippable.

---

## 17. Each container ships its own stylesheet, scoped to its own mount roots

**Status:** decided, with two stated limits.

A container compiles the CSS for the classes it uses: Tailwind's theme and
utilities layers plus `@tecton/react/styles/scoped.css`, the design system's
utilities-only entry, and deliberately not `@import "tailwindcss"`, which would
bring preflight with it. `@tecton/react/postcss/scope` — the library's own
plugin, called with the framework's selectors — then wraps the result in
`@scope ([data-mfe-scope="<id>"], …) to ([data-mfe-scope])`: one selector per
definition the container exports, and a lower boundary that ends a parent App's
scope at the root of a nested one. The shell keeps the document-level half no
container can own — preflight, font faces, `@property` registrations and every
theme variable on `:root` — which inherits into every mount, so a tenant
customisation or a mode flip in the shell reaches every container with nothing
wired up. Each mount renders the `ThemeRoot` the build attached to its
definition, from the container's own copy of the library, so a dialog or a
popover portals into that mount's overlay root, which carries the same
`data-mfe-scope` and is styled by the same stylesheet.

`@scope` is the feature with the narrowest support of anything the framework
requires (§5), and below that floor the cascade is unscoped, so the last
container's stylesheet on the page wins. `@property` and `@font-face` register
a name for the whole page, so two containers registering the same one get
whichever the browser parsed last — in practice those names come from Tailwind
and from the shared design system, whose definitions of them agree — while
`@keyframes`, document-global the same way, is renamed after the container's
ids along with every reference to it.

This supersedes the original decision, that the page had one stylesheet and the
shell scanned every container's sources to build it, which held only while every
container lived in this workspace.

---

## 18. React Refresh only replaces a module whose every export is a component

**Status:** fixed in the shell; a rule for anything with a dev server.

Editing the shell chrome reloaded the whole page instead of hot-updating the
component. The cause was not the bundler: `chrome.tsx` exported two hooks beside
its components, `router.tsx` exported a factory, and React Refresh treats a
module with any non-component export as unable to accept an update. The update
then propagates to the importer, and the importer, until it reaches the entry —
which accepts nothing, so the page reloads.

Splitting the hooks into `shell/hooks.ts` and the boot facts into
`shell/workspace.ts` is what fixed it. `dev.lazyCompilation` is off for a
related reason: it wraps the entry in a proxy module that is not a refresh
boundary either, so every update reached the entry through it.

The same rule reaches an MFE author, and there it is not optional: `src/mfe.ts`
exports a definition and its contract by contract, so it can never be a refresh
boundary. A Widget whose render function is written inline in the entry
therefore reloads the page on every edit. Moving the render into its own module
— every export a component — is what makes editing a Widget feel like editing a
component, and it is measurable: `pnpm hmr:probe` reports "hot-updated in place"
for `examples/alert-panel/src/alert-panel.tsx` and "the page reloaded" for the
entry beside it.

**Consequence:** in a module that exports components, export only components,
and keep an MFE's render functions out of its entry. The failure is silent —
everything works, just slower and with lost state — and it reads as a bundler
problem rather than a module-shape one, which is why `pnpm hmr:probe` exists to
answer the question directly.

## 19. The generated build time advances with the build hash, not with the compilation

**Status:** fixed in `@company/mfe-rspack`.

Hot updates still failed after §18, and only in `lab` — the one container whose
page imports `#mfe/meta` to display it. The browser logged
`[rsbuild] HMR update failed, performing full reload: TypeError: Failed to
fetch`, which reads as a bundler or a network problem and is neither.

The build regenerates the container's modules before every compilation, so that
what a build writes and what an editor reads come from one function. Two of
those modules carried `new Date().toISOString()`: `meta.ts` and the registry
descriptor. `writeGeneratedFiles` skips a file whose contents are unchanged, but
a timestamp is never unchanged, so both were rewritten every time — and
`meta.ts` is a module the container imports. Writing it was a source change; the
watcher started the next compilation; that compilation rewrote it again. The
container rebuilt forever, a few times a second, and each rebuild invalidated
the hot update the page was in the middle of fetching. The dev server did the
only thing left and reloaded the page.

Nothing was wrong with the container that did not import `#mfe/meta`: a
generated file outside the module graph is not watched, so the same rewrite
cost nothing. The defect was invisible until something used the feature.

The fix is to make the recorded time mean what the build hash already means.
`buildHash` is a content hash of the generated files that carry no time, and is
documented as stable across rebuilds of identical sources; the recorded time is
now the time that hash was first generated, carried forward from the descriptor
on disk whenever the hash matches. Identical sources therefore regenerate byte
for byte, and the rewrite — with the rebuild loop behind it — stops. A caller
that fixes `buildTime` still gets exactly that, so a reproducible build and the
tests are unaffected.

**Consequence:** a build that runs on every compilation must be a pure function
of its inputs, because its outputs are among its inputs. A timestamp, a counter
or a random id in generated code turns a watching build into a loop, and the
symptom appears at the far end of the system — in the browser, as a hot update
that cannot be fetched.

---

## 20. An App blocks navigation with TanStack's own `useBlocker`, and the framework widens it

**Status:** decided, load-bearing.

An editor with unsaved changes is the only thing that knows the changes exist.
The navigation that discards them is usually one it does not own: a link in the
shell's chrome, another application in the finder, the browser's back button.
Those move the _shell's_ router, over the shell's own history, and an App's
blockers are registered with neither.

The first answer was a framework hook, `useNavigationBlock`, which registered
directly with the host's navigator. It worked, and it was the wrong default: it
is a second way to express something the author's router already expresses, it
does not cover the App's own routes, and an author has to know it exists.

So the mount now registers _one_ delegate with the navigator
(`packages/mfe-react/src/router-blockers.ts`) and answers it out of whatever the
App's router has registered. An author writes TanStack's `useBlocker` and
nothing else; a navigation from the shell arrives as an ordinary `shouldBlockFn`
call, with `current`, `next` and `action` resolved against that App's own route
tree, and a target outside the App simply matches no route.

Three details are forced rather than chosen:

- **The delegate is registered for the mount's whole life**, not only while a
  blocker exists. `shouldBlockFn: () => isDirty` is a new function on every
  render, so TanStack unregisters and re-registers on every render — including
  the render that opens the confirmation dialog. Anything keyed on the set being
  non-empty, or on one blocker's identity, misreads that churn as removal and
  lets the navigation through while the dialog is on screen.
- **`enableBeforeUnload` is asked, not counted.** A reload is not a navigation
  and no page may draw its own UI for one, so the host asks its blockers a
  separate synchronous question (`shouldBlockUnload`). Counting registrations
  instead — which is what the shell did — armed the browser's "leave site?"
  prompt on every reload of any page that merely had a blocker mounted.
- **An external navigation is held until the negotiation settles.** A browser
  back moves the URL before anyone is asked, so a mount told about it straight
  away leaves the page the user is still being asked about: the confirmation
  appears over the next screen with the unsaved form already gone. The navigator
  holds those events while it negotiates and releases them only on a proceed —
  a refusal is followed by the host restoring the URL, which arrives as an event
  of its own. It is deferred by a microtask so it does not depend on the order
  the host's popstate listener and the mount's were registered in.

`useNavigationBlock` remains for a mount with no router of its own: a Widget,
or anything mounted outside one.

**Consequence:** the supported way for an App to refuse a navigation is the
router's, and the framework's job is to make it cover navigations the router
cannot see. A host opts in by routing its own navigations through
`runtime.navigator.requestNavigation(...)`.

---

## 21. Storage retention is named for who owns a record, not for how long it lives

**Status:** decided, load-bearing.

`StorageRetention` was `'session' | 'preference'`, alongside `StorageArea`'s
`'local' | 'session'`. Two problems, and the second is the one that matters.

**`'session'` meant two different things in one declaration.** `storage:
'session'` selects `sessionStorage`, which the browser empties when the tab
closes. `retention: 'session'` bound a record to the signed-in identity, which
is unrelated — a `retention: 'session'` record in `localStorage` outlives every
tab, and a `retention: 'preference'` record in `sessionStorage` still dies with
the tab. All four combinations are legal and two of them read as tautologies
that are not.

**`'preference'` promised the opposite of what it did.** The physical key is
`<definitionId>:<name>` with no user component, a `'preference'` record carries
no generation stamp, and the store-wide purge removes only session-retained
records. So a "preference" written while one person is signed in is read back
by the next person to sign in on that browser profile. The word invites exactly
the data it must not hold: an author reaches for `'preference'` _because_ they
are storing something personal. `examples/operations` had already done it, for
table density.

The names are now `'user'` and `'browser'`, and the axis still reads
`retention` because the property name is not where the confusion was:

```ts
{ storage: 'local',   retention: 'user'    } // wiped when identity or groups change
{ storage: 'local',   retention: 'browser' } // survives, and everyone here reads it
{ storage: 'session', retention: 'user'    } // dies with the tab, also wiped on sign-out
{ storage: 'session', retention: 'browser' } // dies with the tab, survives a sign-out in it
```

Every row now says what it does, and `'browser'` carries the warning that
`'preference'` concealed: nobody writes `retention: 'browser'` for something
they believe is private to the signed-in user. `'user'` stays the default, so
the safe answer is the one you get by not deciding.

Two consequences were accepted rather than worked around:

- **The persisted `r` field changed with the type.** Keeping `'session'` and
  `'preference'` on the wire while the API said `'user'` and `'browser'` would
  have rebuilt the same confusion one layer down — and the lab page tells
  developers to open devtools and read the raw envelope. Nothing is published
  yet (`initial-framework` is still an unconsumed changeset), so there is no
  deployed data and no compatibility shim to carry forever. A record written by
  an earlier build reports as unreadable rather than being silently replaced by
  the declared default, which is the documented behaviour for any record the
  framework cannot parse.
- **The declaration property is `storage`, not `area`.** The same concept was
  called `storage` by `useStoredState` and `area` by `MfeStorageStore.bind`, so
  an author who moved between the two surfaces met a rename for no reason. The
  `StorageArea` _type_ keeps its name: "storage area" is the Web Storage spec's
  own term, and `StorageEvent.storageArea` is a real DOM property.

Retention stays a choice in the reserved host scope (§24), and it is the same
choice: `'browser'` for impersonal page state, `'user'` for anything derived
from who is signed in. The scope says whose record it is; retention says who
may read it back.

---

## 22. The developer tools ship in production and are gated at runtime

**Status:** decided, with a stated cost.

Every other developer-only thing in the framework is guarded with `DEV` from
`@company/mfe-core`, which folds to `false` in a production build and takes the
guarded statement with it. `@company/mfe-devtools` deliberately is not.

The reason is the use case. The panel's job is repointing a container at a dev
server, and the page where that is hardest to do — and most worth doing — is a
deployed one, where no rebuild is available and the question is which manifest a
surface actually loaded. `DEV` would delete the answer exactly where it is
needed. So the gate is a runtime flag instead: `localStorage["company:mfe:devtools"]`,
or `?devtools=1`, which persists so the parameter is needed once.

What that costs is a storage read and a `null` return on every page load, which
is the whole of `devtools-mount.tsx`. Everything else — the trigger, the panel,
the design-system subpaths only it reaches for — is behind a dynamic `import()`
that is evaluated the first time the flag reads true, and never otherwise. A
test asserts the loader is called zero times when the flag is off, and a second
asserts nothing reachable from the package's barrel by a static import lives in
`src/panel/`; a re-export there would put the chunk back in the host's initial
bundle and leave the import doing nothing, which is invisible at runtime because
the tool still works.

Two consequences worth naming.

The registry view moved into the panel and is therefore behind the flag, so
every control that used to open it — `g r`, the palette, the settings footer and
the dashboard button — turns the tools on rather than assuming they are. (The
header action and the notice strip that also opened it were removed; §23.)

And the shell's stylesheet now carries an `@source` for a `packages/*`
directory. Tailwind emits a utility only for a file it scanned, the tools render
into the shell's own document rather than into a scoped mount, and §17 leaves
the document-level half the shell's alone — so the one line is the correct
place for it. A host outside this workspace needs the same line pointing into
its `node_modules`, until the package ships a prebuilt utilities sheet the way
`@tecton/react` does. Recorded here rather than discovered at the first
deployment.

---

## 23. The override strip was removed, and nothing replaced it on the page

**Status:** decided, against the previous decision, with the cost stated.

§22 kept the notice strip under the header on the grounds that an override
nobody can see is the phantom bug the override mechanism exists to prevent. The
strip is gone, along with the header's registry action, because a band of
warning text above every page is a high price to pay on every page for a
condition that is rare and self-inflicted, and because the strip was the loudest
thing in the chrome on a page where nothing was wrong.

What replaces it is weaker and that is the point of writing this down. The
developer tools' trigger carries a mark while an override is applied, and the
Overrides tab names each one — but both are behind the flag, so a developer who
has never turned the tools on sees nothing at all. The failure the strip existed
to prevent is now possible again: an override pointing at a dev server that is
no longer running looks like a broken deployment.

Two things keep it from being silent. `pnpm dev` still prints the snippets and
still says the shell reports an active override, and `collectDiagnostics` now
carries both the overrides and any `registry.json` failure into the bug report —
the latter added here, because the strip had been its only reader and removing
it would have made a registry that never loaded invisible rather than merely
quiet.

A third was added afterwards, and it is what makes the other two an audit trail
rather than a hope: every framework diagnostic now reaches the shell's telemetry
provider (§25), where the hub the runtime built had no sinks at all. The report
names the build behind each registry entry too (§29) — "which override" and
"which build" are the same question asked twice.

---

## 24. The host page had no storage scope, and the lint allowlist was the evidence

**Status:** decided, load-bearing.

Three shell files were exempted from `mfe/no-raw-storage` by name, and the
comment beside each said a version of one sentence: this state belongs to the
page rather than to any definition on it. Between them they had rebuilt a
validator, a listener set and an untyped JSON round trip, for state no less
persisted than a definition's. An allowlist that grows for one reason is a
missing primitive with its evidence written beside each entry.

`bindHost()` and `hostStorage()` reach a reserved scope whose id is
`HOST_SCOPE`, `'@host'`; `bind`, `storageFor` and `clearDefinition` refuse it
and name them in the repair. The `@` is what makes it reserved rather than
conventional: a definition id is lower-case letters, digits and single hyphens,
so no registry entry can ever claim that name, where a shell that agreed with
itself to use `"shell"` could not be told from a definition of that id.
`useStoredState` resolves by position rather than gaining a sibling, the way
`useCommand` does (§26). The session generation moved on a sharper version of
the same argument — the record every `retention: 'user'` write is fenced by
cannot be gated by the thing it establishes — so `establishSessionGeneration`
writes it host-scoped, `retention: 'browser'`, in `sessionStorage`, and
`createMfeRuntime` calls it for the identity in `shellState` (§25).

**The theme went back, and is the one exemption that survives.** Of the three it
is the only one whose key was never ours to choose: the legacy Angular
applications read `localStorage["theme"]` directly as the bare string `light` or
`dark`, and they are not being rebuilt to read anything else. Writing an
envelope under a scoped key is what the store is for — versioned,
retention-tagged, fenced by a generation — so `@host:theme` is neither the name
nor the shape that contract needs, and no option on the store would produce
them. The shell therefore writes the key itself, in
`apps/shell/src/shell/preferences.ts`, named in `storageAllowedScopes` with that
reason beside it. Only the persistence is raw: `runtime.shellState` still holds
the value, every switch is a `shellState.apply({ theme })`, and one effect in
the chrome applies the class, `colorScheme` and `writeTheme`. The pre-paint
script in `index.html` reads the same bare key, accepts only `light` or `dark`
and falls back to `prefers-color-scheme` — it must never be why a page fails to
paint.

**The old keys are not migrated**: `company:shell:theme` and
`company:shell:dashboard` are orphaned where they lie, on §21's reasoning that
nothing is published yet — spent for the second time here, and not available
again after a release. The dashboard canvas starts empty; the theme reads
whatever is under `theme`, which is where the legacy applications were already
writing it.

**Consequence:** the allowlist is not empty, so what an entry has to prove is
what changed. `preferences.ts` earns its line because the key's name and shape
are fixed by code outside this repository. An entry that cannot say that much —
one added because the store is scoped, or gated, or inconvenient — is evidence
of another missing primitive, not a local exception.

---

## 25. The runtime adopts the shell's hub, and owns everything else

**Status:** decided, forced by a bug that dropped every diagnostic.

`createMfeRuntime` built its own `DiagnosticsHub`, nothing ever added a sink to
it, and `report()` returns on its first line when the sink set is empty. Every
rejected override, every quarantined entry and every unreadable record was
collected, attributed, structured and thrown away, while the shell had a Faro
telemetry provider the whole time — the failure class §11 describes, landing on
the diagnostics themselves.

So the hub is the shell's and `createMfeRuntime({ diagnostics })` adopts it.
Ordering forces that one option rather than taste: `installShellAuth` runs
before any remote is registered, so a hub the runtime creates is one auth can
never report into. What goes into the hub is the framework's too:
`telemetryDiagnosticsSink(provider)` is the one translation from a `Diagnostic`
to a `TelemetryRecord`, and `new DiagnosticsHub([sink])` takes it before
anything can report. Putting that translation in a package whose telemetry
contract has no diagnostics shape in it (§10) was the thing this entry once
refused. A sink a host installs by name is not that refusal broken: nothing is
forwarded unless the host asks, and the alternative was every shell writing the
same twenty lines.

Nothing else is adopted. The store option went with the ordering argument that
justified it: the dashboard canvas is a hook over `useStoredState`, and no
framework record is read before the runtime exists. The theme is not a
framework record at all (§24) — the value the runtime is created with is
decided by `preferredTheme()`, the same way and in the same order the pre-paint
script decided the class already on `<html>`, without the store.
`createMfeRuntime` therefore builds the store, and establishes the first session
generation itself for the identity in `shellState`, because that was the last
thing a shell had to do in the right order and get right.
`dispose()` still tears down only what the call created: the store it made, and
on a supplied hub only the sinks it added.

**Consequence:** a hub with no sinks is silent by design, and `createMfeRuntime`
cannot warn about one because a host may supply its sinks later. It is written
down here instead.

---

## 26. The host page is a scope, and reading the registry is a selector

**Status:** decided; every disagreement below had already happened.

The shell had invented whatever the framework would not give it. Breadcrumbs
called `registerMount('shell', 'shell#0', 0)` — a made-up definition id and a
token `removeMount` could not tell from a real one — and the palette hard-coded
its own commands rather than registering them. `[...entries.values()].filter(…)`
was written again in the shell's hooks, in the settings sheet and in the
developer tools, and two of those copies already disagreed: one flattened
`app.capabilities` unfiltered, offering each App's help and release-notes pages
as settings, and the active application was derived one way from a router match
and another from a path split. The one capability lookup nobody had rewritten
sat inside `selectReleaseNotesRoute`, in the removable legacy adapter.

`HOST_SCOPE` (§24) is the name the page should have had here too:
`CommandRegistry.registerHost()` registers in it and `register()` refuses it,
`useCommand` outside a mount registers there, and `useBreadcrumbs` outside one
publishes at depth 0, the depth every mount composes below. `useTheme`,
`useUser` and `useGroups` stopped requiring a mount at all, since none of them
used the mount's identity and the host publishing the theme could not read it
back. The reads are written once as `useRegistryEntries`, `useApps`,
`useWidgets`, `useCapabilityPages(name?)` and `useActiveDefinition(pathname)`,
over `boundaryDefinitionId(url)` and `capabilityRoute(entry, name)` in the
neutral host; `selectReleaseNotesRoute` composes over `capabilityRoute` and
keeps only its genuinely legacy branch, so deleting the legacy package no longer
takes a core capability with it.

Two limits are accepted. `useActiveDefinition` takes the pathname rather than
reading the URL, because the host owns its router and the only thing the
framework could subscribe to is the navigation bridge, which never hears the
`pushState` a router performs. And the selectors select and nothing else: an
icon, a fallback title and the tone that marks an override stay the host's,
because a selector returning something renderable would be the first UI this
framework ships outside the developer tools (§22).

---

## 27. A host asks the build integration for its share scope instead of writing it twice

**Status:** decided; `@company/mfe-rspack/federation`.

The shell's `rsbuild.config.ts` resolved a share scope of its own, out of the
same candidate list, singleton rules and reading of
`@tecton/react/federation/shared` that `pluginMfe()` already resolves one from
for every container. Two copies of one policy, and the disagreement between them
is silent: nothing fails at build time, the page loads, and then a remote mounts
and a framework hook inside it fails with "rendered outside any mount" — a
message about the mount and not about the share scope that caused it.

`hostShared({ root })` applies that one policy to the host's own install. Two
things differ from the container side, both because a host provides the
modules rather than consuming them. It advertises the version it installed and
never the range it declared, because the share scope describes the copy it is
putting in. And it shares what it can resolve rather than what it lists, which
is how `@company/mfe-core` — reached through the adapter, never a shell's
declared dependency — is provided at all, and why a candidate that resolves
nowhere is left out. Resolving none of them is a build error naming the repair:
individual absences stay legal, but a host that shares nothing cannot mount
anything.

**Consequence:** this is deliberately the whole host-facing surface of the build
package, and a subpath rather than part of the root, which is `pluginMfe()` and
everything a container's build needs. A host's entry, document, dev server and
define plugin stay its own; the share scope is the one thing it and every
container have to agree about.

---

## 28. Reading a Widget's published inputs is headless, and a test is what keeps it honest

**Status:** decided; the drift had already shipped.

§16 records why the registry carries each Widget's contract. Three readers then
walked that published JSON Schema for themselves — the shell's dashboard, the
developer tools and the palette — and drifted. The build's static Zod reader
publishes `const` for a literal and `anyOf: [<schema>, { type: 'null' }]` for a
nullable one; the shell's copy classified a field by `enum` and `type` alone, so
both fell through to the raw JSON box. Nothing reported it — a reader falling
through to "I cannot classify this" is honest and useless in the same breath.

`describeWidgetInputs(contract)` is that walk, once, beside the contract it
reads, with `defaultInputsFor`, `coerceInputs` and `needsInputPrompt` for the
questions a host asks next. §16's distinction is in the return type: `null` is
"the build could not describe this", `[]` is "this Widget takes nothing", and a
host rendering an empty form for the first tells the developer something untrue.
Nothing here validates; the provider still parses every input.

The drift guard is the part worth recording. `@company/mfe-core` cannot import
the build integration and should not, so `widget-inputs.test.ts` lists every
construct `zod-static.ts` can emit, as the shape it emits, and asserts the kind
that comes back: a row reporting `unknown` is the reflector falling behind the
emitter, and it is the cheapest substitute for a dependency the architecture
forbids.

Events are the same asymmetry on the other side of the contract, and the shell
had reimplemented the framework's own `on` + capitalized-name mapping at a
distance. `DynamicWidget` gains `onEvent?: (name, payload) => void`, routed by
the events the provider declares, with `eventNameToHandlerProp` exported for a
host that wants one named prop instead. `lazyWidget` deliberately gets none:
with a contract every event is already a typed prop, and a catch-all would say
the same with `string` and `unknown`. Names are all a consumer has only where
there is no contract by construction (§15).

**Cost:** which control to draw for a kind and what a blank one starts as stay
in the host, because a framework that picked a select for an enum would be
shipping a control set (§22).

---

## 29. A registry entry names the build it came from

**Status:** decided; the bug report was the only reader that needed it.

§23 left the bug report as the only place on the page where a developer can find
out what the shell was running, and it could name no build at all.
`BuildProvenance` (`hash`, `time`, meaning what §19 made them mean) is now a
named type in the core, `NeutralRegistryEntry.build` carries it, the registry
builder copies it from the container descriptor, and the shell's report lists
one line per accepted entry.

Three details are forced rather than chosen:

- **It is validated loosely and never quarantines.** A container that cannot
  describe its own build still mounts, but a malformed `build` is dropped rather
  than passed on: a hash that is not a string would reach a bug report as
  `[object Object]` and be believed.
- **An entry whose descriptor named no build says so.** Leaving the line out
  would read as a missing container, a much more alarming claim.
- **It is a list, not a value.** Every surface on the page was built separately,
  and the registry is the only place that answer can be read without loading the
  container — exactly the situation a bug report is written in.
