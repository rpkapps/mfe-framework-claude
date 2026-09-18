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
history over the explicit navigation bridge instead. The router still gets a
fully functional history, including native blocker support, because
`createHistory` consults the blockers it is handed.

**Consequence:** the framework never calls `createBrowserHistory`, and a
contributor who reaches for it reintroduces the banned patch. The `mfe/no-global-patching`
lint rule catches direct patching but cannot catch this, so it is written down here.

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
React and the design system — the singletons whose share scope has to resolve
consistently.

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
