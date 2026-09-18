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

## 5. Browser coverage with native `@scope` is below the 91% target

**Status:** open finding. The gate fails honestly.

The browser support policy requires at least 91% aggregate global usage coverage
with native CSS `@scope` available in every supported browser, and no fallback.

Measured with caniuse-lite 1.0.30001810: **89.9685%**, a 1.03 pp shortfall.

`@scope` is the entire gap. The same feature intersection without it measures
95.6886%. The shortfall is mainstream users on pre-`@scope` releases, not exotic
browsers — Chrome below 118 (2.51%), Firefox below 146 (1.52%), iOS Safari below
17.4 (1.01%).

Worth knowing: caniuse's global usage table itself sums to 96.6878%, not 100%,
so the matrix already covers roughly 93% of everything the dataset accounts for.
Firefox only shipped `@scope` in 146, so this figure improves on its own with
each quarterly refresh.

`pnpm browser-matrix` exits non-zero. It was left failing rather than tuned to
pass: lowering the target, shipping a fallback, or accepting a red gate for a
period are all policy decisions, not tooling ones.

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

| Condition                                       | Code used            | Why it is approximate                                                                                                                                                                                                                                      |
| ----------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session refresh failed                          | `config/unreachable` | The session endpoint could not deliver a usable token. This is a session-level event. The `SessionFailure` channel that used to carry a precise reason alongside it was removed when session ownership moved to the shell, so the approximate code is now the only signal the framework gives. |
| A 401 response whose request cannot be replayed | `config/invalid`     | The request as configured cannot be replayed. Nothing in the union describes replayability.                                                                                                                                                                |

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
