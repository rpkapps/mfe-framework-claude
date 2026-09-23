# Architecture decisions and findings

Each entry records a decision that was forced by evidence rather than taste, so
a future maintainer can tell which constraints are real and which are
preferences. Where a gate produced an uncomfortable answer, the uncomfortable
answer is recorded rather than smoothed over.

---

## 1. The boundary history is built by hand, because `createBrowserHistory` patches globals

**Status:** decided, load-bearing.

TanStack's `createBrowserHistory()` reassigns `window.history.pushState` and
`replaceState`: action at a distance that breaks anything else wrapping them, and
two routers on a page fight over the URL. `boundary-history.ts` builds each App's
history over `createHistory()` and the navigation bridge instead; the host's
navigator only listens for `popstate`. Three capabilities were missing, all
silently: `block()` is a no-op without `setBlockers` beside `getBlockers`; entries
carried `history.state === null`, so no delta could be computed; and a
subscription made in the constructor was removed by the first cleanup and never
re-made (§14), so construction is pure and `attach()` listens. A missing one does
not announce itself.

---

## 2. One generated route tree can back two concurrent mounts

**Status:** proven against the pinned versions; kept as a regression test.

The design depends on `routeTree.gen.ts` being a description rather than an
instance, so one statically imported tree can back two concurrent mounts at
different boundaries. Tested in `tracer-bullet.test.tsx`: two routers built from
one tree keep independent histories and independent matches, and navigating one
does not move the other. No tree clone is needed, and if a future router version
breaks this, that test fails first.

---

## 3. The pinned router exposes enough state to validate the entry contract

**Status:** proven.

Mount-time validation needs to see what the author's factory actually built.
`router.options.basepath` and `router.history` are both observable supported
state, and `router.history === suppliedHistory` is an exact identity check, so an
App that ignores the supplied `basePath` or substitutes its own history fails at
mount, naming the one-line repair, rather than rendering at the wrong boundary
and surfacing much later.

---

## 4. Browser async context does not propagate across `await`, and we do not pretend it does

**Status:** honest limitation, documented in code and tests.

Trace parentage is a synchronous active-span slot, so a span created _after_ an
`await` inside an active callback loses the ambient context and becomes a root
with a fresh trace id. The failure mode is the decision: an unsupported case
produces **no parent**, never a wrong one, because a wrong parent corrupts a
production trace tree silently. `node:async_hooks` was rejected because it would
make correlation pass in the Node test runner and fail in browsers.

---

## 5. The browser support matrix was removed

**Status:** decided, at the project owner's direction.

A tool here measured usage coverage for the features the framework depends on
against a 91% target and failed: **89.9685%** with caniuse-lite 1.0.30001810,
native CSS `@scope` being the entire gap. The owner removed the tool rather than
tune it: a policy target recomputed on every CI run invites the target to be
edited until it passes. `@scope` is still the narrowest-supported feature the
framework requires, emitted with no fallback, so an audience on Chrome below 118,
Firefox below 146 or iOS Safari below 17.4 sees unscoped CSS.

---

## 6. Federation lives in the React adapter, not in the neutral host

**Status:** decided.

The neutral host must not import Module Federation, but something has to load
containers, so the host defines a `ContainerLoader` port and orchestrates loading
through it while the federation implementation ships from the React adapter,
which already depends on React — the strict singleton whose share scope has to
resolve consistently. The tracer bullet therefore runs with an in-process loader,
and federation-specific values travel in the registry record's adapter-private
payload, so the neutral shape stays free of that vocabulary.

**Amendment (2026-09-22):** the adapter-private payload is gone, and so is the
last place the host named an adapter. `@company/mfe-core` holds `MfeAdapter` and
the common `RegistryEntry` shape and names no framework; each adapter ships its
own entry type, with its own fields typed on it and reached through its `is()`
guard, so the federation container name is `ReactRegistryEntry.container` rather
than an `unknown` the loader casts back. The React adapter's registry code moved
out of `@company/mfe-runtime` into `@company/mfe-react`, where the federation loader
already lived. The host now knows only the interface, which is what the port was
always meant to buy: one payload nobody could type, re-validated at every reader,
was buying the opposite.

**Second amendment (2026-09-22):** the federation loader moved back into the host,
because a second adapter made it shared. A React shell loading an Angular container
needs the same loader as an Angular shell loading a React one, and neither adapter
can own it. `createFederationContainerLoader` in `@company/mfe-runtime` still imports no
Module Federation — the runtime is handed to it, as it always was — and reads only
what every adapter's entries and definitions have in common: the container name on
`FederatedRegistryEntry` and the brand each adapter stamps, which now also names the
framework that built the definition. What was React's in the old loader was one
shim, hiding TanStack Router's development global while a container evaluates, and
that is all `createMf2ContainerLoader` adds now, through `aroundLoad`. The same
reason gave every definition a neutral `mount`: a host cannot render another
framework's tree, so a definition mounts itself into an element the host provides,
given the host's `MountContext`, and hands back what the host needs to update and
dispose it. React definitions carry it too, so an Angular host can place a React
Widget or App; a React host still renders its own definitions directly and reaches
for `mount` only for the others.

---

## 7. Two error conditions have no exact code in the closed union

**Status:** deviation, flagged for review.

`MfeErrorCode` is a closed union and adding a code is a deliberate contract
change, so two conditions use the nearest available one. A failed session refresh
reports `config/unreachable`, the only signal left once the `SessionFailure`
channel went with session ownership to the shell; a 401 whose request cannot be
replayed reports `config/invalid`, because nothing in the union describes
replayability. Both therefore read as configuration faults to anything that reads
codes; `failSession` and `warnNotReplayable` are the two call sites to change.

---

## 8. The pnpm version is not pinned

**Status:** deliberate deviation, at the user's direction.

The dependency policy asks for an exact `packageManager` pin. The project owner
asked for the latest pnpm instead, so the root manifest carries no
`packageManager` field and a contributor's pnpm version is whatever they
installed. Everything else stands: the lockfile is committed, CI installs with
`--frozen-lockfile`, and `pnpm-workspace.yaml` carries `strictDepBuilds: true`,
`dangerouslyAllowAllBuilds: false` and an `allowBuilds` map recording why each
dependency may run an install script.

---

## 9. Legacy Angular compatibility is proven against fixtures, not the real applications

**Status:** scope limit, stated plainly.

The legacy Angular repositories are not available here and the first slice may
not require them, so the adapter is tested against production-equivalent contract
fixtures and doubles. Those prove the translation of legacy registry fields into
the neutral record, that legacy vocabulary stays out of the neutral shape, and —
most importantly — that an entry advertising a malformed new contract fails
rather than being reinterpreted as legacy, where a typo would change how an app
loads unnoticed. They do not prove that the real applications mount and unmount;
that is the entry condition for the legacy gate.

**Amendment (2026-09-22):** that guarantee no longer rests on evaluation order.
Ordered rules bought it by putting the framework rule first, which meant the
guarantee lived in a list the shell assembled rather than in either adapter.
Exactly one adapter must now recognise an entry: none and it is rejected as
unrecognised, more than one and it is rejected as ambiguous, with both adapters
named. `reactAdapter.detect` still recognises any entry carrying an `mfe` key
however malformed, and `legacyAngularAdapter.detect` still recognises only entries
without one, so the same entries reach the same adapter — but now because of what
the two adapters say about themselves, and not because of where a shell put them
in a list. The shell in this repository registers the legacy adapter, so a legacy
entry in its registry is read rather than rejected.

---

## 10. The framework owns no session; the shell installs one and the container binds to it

**Status:** decided after a course correction, load-bearing.

A framework that implements a session beside the shell's guarantees two sources of
truth for one credential. It owns the interceptor instead: the token is attached
at the request boundary, only to origins the author declared `{ api: true }`.

**A single host-wide session is the requirement, not a shortcut.** §10.5 makes
refresh single-flight across every mount; with rotating refresh tokens a second
concurrent refresh presents a credential the server already retired, logging the
user out, so a per-mount token source would be the bug. `#mfe/fetch` is evaluated
with no host in scope, so the seam is two-sided: `installShellAuth` before any
remote is registered, and `createContainerTransport` carrying what the build
knows.

---

## 11. Three failures were reported green by checks that could not see them

**Status:** finding, recorded so the class is recognised rather than the
instances.

Each passed every gate in this repository while being broken, and none was found
by a test; all three were found by running the thing. The class is the point:
each check measured a proxy for the thing rather than the thing — emitted text
instead of a resolving module, compilation instead of boot, a declared dependency
instead of a loaded declaration. So generated output is now type-checked, the
jest-dom matcher augmentation lives in the same file as the `expect.extend` that
makes it true at runtime, and a green suite is not a claim that the software
runs.

---

## 12. A federated page needs its own verification, because nothing else sees it

**Status:** decided after five defects in a row, load-bearing.

The first time the shell loaded a real container, five separate defects surfaced;
all compiled, type-checked and passed the whole suite while rendering nothing.
Three come from one assumption held by tools the framework does not own — **one
application per page** — among them Rspack's lazy compilation, which serves chunks
from the dev server's own origin, so a cross-origin remote's request never arrives
and nothing reports it. `pnpm run verify:page` therefore loads the page in a real
browser, one assertion per defect: a container mounted, a Widget from a _second_
container inside it, the chrome once, no hook outside a mount.

---

## 13. The build integration is an Rsbuild plugin, not a bare Rspack plugin

**Status:** deliberate deviation, at the project owner's direction.

§10.7 and acceptance criterion 26 say `mfePlugin()` is a normal Rspack plugin.
`pluginMfe()` is an Rsbuild plugin instead, still one entry in a `plugins` array
that contributes configuration and never replaces it, because declaring
`moduleFederation.options` is what makes Rsbuild derive the paths a remote needs.

**Three costs, caught only by loading a real page.** Rsbuild replaces the
federation plugin's `manifest` option, so `manifest.additionalData` never runs and
the Rspack half injects the contract metadata into the emitted asset. Its default
asset prefix is the serving path `/`, the _shell's_ for a remote, so `pluginMfe()`
sets `assetPrefix: 'auto'`. And its federation defaults are guarded on
`moduleFederation.options` already being present, which a plugin's options arrive
too late for: `server.cors`, `dev.assetPrefix` and `dev.client.port` went silently
missing.

---

## 14. A mount built in `useMemo` does not survive a remount, and StrictMode remounts everything

**Status:** fixed; pinned by `packages/mfe-react/src/strict-mode.test.tsx`.

`AppHost` and `lazyWidget` built their mount in `useMemo` and disposed it in an
effect cleanup. React mounts, unmounts and mounts again without re-rendering —
StrictMode on every development mount — and the memo is not re-evaluated, so the
second setup ran against the mount the first cleanup had disposed:
`CancelledError` in development while production worked. The mount is now created
by the effect that destroys it (`useOwnedMount`).

**Consequence:** "created in a memo, destroyed in an effect" is not a safe pairing
in React 18 and later. The boundary history was the next instance (§1): a
subscription made at construction, removed by the first cleanup and never
re-made.

---

## 15. A host composing the registry cannot call `lazyWidget`

**Status:** decided; `DynamicWidget` added.

`lazyWidget(id)` is a module-scope call, enforced by `mfe/stable-definitions`,
because the returned component's identity is what React uses to decide whether it
is the same element: one built during render remounts the Widget on every pass.
That rule is unfollowable for a host that discovers its Widgets at runtime, so
`DynamicWidget` takes the id as a prop and builds nothing during render. It is
the contract-free mode by construction; the provider still validates every input
and event payload, so only the consumer's types are weaker — hence the registry
publishing the input schema (§16).

---

## 16. The registry carries each Widget's contract, because a catalogue is rendered before anything is fetched

**Status:** decided; emitted by the build, validated by the host.

A host offering Widgets in a picker renders it before anything is loaded, so if
the only way to learn what a Widget takes is to load its container, a catalogue
cannot exist. The build therefore reads each Widget's own Zod schemas statically,
from syntax, and publishes them in the container descriptor the registry carries;
the shell's dashboard renders a select for an enum from that. `inputs` is absent
when the schema is not statically readable, and absent is never the same as
empty. An unreadable schema does **not** fail the build: a Widget still mounts
and still validates its own inputs.

---

## 17. Each container ships its own stylesheet, scoped to its own mount roots

**Status:** decided, with two stated limits.

A container compiles only the CSS for its own classes; the shell owns the
document, so no preflight and no theme variables travel with it. The framework
supplies the selectors and the design system's own plugin does the scoping, after
`@tailwindcss/postcss`: one `@scope` rule per definition over `[data-mfe-scope]`,
with a `:root`/`:host` rewrite onto that root. Each mount renders the `ThemeRoot`
the build attached, from the container's own copy of the library, so popovers take
their portal target from that copy's context — an overlay root carrying the same
attribute. Two limits: `@scope` has the narrowest support of anything the
framework requires (§5), below which the last stylesheet wins unscoped; and
`@keyframes` is renamed after the container's ids, because such names are
page-wide.

---

## 18. React Refresh only replaces a module whose every export is a component

**Status:** fixed in the shell; a rule for anything with a dev server.

Editing the shell chrome reloaded the page instead of hot-updating the component,
and the bundler was not the cause: `chrome.tsx` exported two hooks beside its
components and `router.tsx` a factory, and React Refresh treats a module with any
non-component export as unable to accept an update, which then propagates to the
entry, which accepts nothing. Splitting the hooks and boot facts out fixed it;
`dev.lazyCompilation` is off because its proxy module is not a boundary either.
`src/mfe.ts` exports a definition and its contract, so it can never be one, and a
Widget rendered inline in the entry silently reloads the page on every edit —
which is why `pnpm hmr:probe` answers "hot-updated in place" or "the page
reloaded".

## 19. The generated build time advances with the build hash, not with the compilation

**Status:** fixed in `@company/mfe-rspack`.

Hot updates still failed after §18, and only in `lab` — the one container whose
page imports `#mfe/meta`. The build regenerates a container's modules before every
compilation and two carried `new Date().toISOString()`; `writeGeneratedFiles`
skips a file whose contents are unchanged, but a timestamp never is, so `meta.ts`
was rewritten every time and the watcher rebuilt the container a few times a
second, invalidating each hot update. The recorded time now means what `buildHash`
means — a content hash of the files that carry no time, stable across identical
rebuilds and checkouts — carried forward whenever the hash matches, not this
compilation's, though a fixed `buildTime` is still recorded as given. A build
running on every compilation must be a pure function of its inputs.

---

## 20. An App blocks navigation with TanStack's own `useBlocker`, and the framework widens it

**Status:** decided, load-bearing.

The navigation that discards an editor's unsaved changes usually moves the
_shell's_ router, where the App's blockers are not registered. The mount registers
_one_ delegate with the navigator, answered from whatever the App's router has
registered: the author writes TanStack's `useBlocker`, a shell navigation arrives
as an ordinary `shouldBlockFn` call against that App's route tree, and a target
outside the App matches no route. `useNavigationBlock` remains for a mount with no
router. Three details are forced: the delegate stays registered for the mount's
whole life, since TanStack re-registers on every render and anything keyed on the
blocker set reads that churn as removal; `enableBeforeUnload` is asked, not
counted, because a reload is not a navigation and counting armed "leave site?" on
every reload; and an external navigation is held until the negotiation settles,
released a microtask later on a proceed.

---

## 21. Storage retention is named for who owns a record, not for how long it lives

**Status:** decided, load-bearing.

`StorageRetention` was `'session' | 'preference'`, and both names lied.
`retention: 'session'` meant the signed-in identity while `storage: 'session'`
means `sessionStorage`. Worse, `'preference'` promised the opposite of what it
did: the store-wide purge removed only session-retained records, so a "preference"
written by one person is read back by the next on that browser profile — and the
word invites exactly the data it must not hold; `examples/operations` had done it,
for table density. The names are now `'user'` and `'browser'`:

```ts
{ storage: 'local',   retention: 'user'    } // wiped when identity or groups change
{ storage: 'local',   retention: 'browser' } // survives, and everyone here reads it
{ storage: 'session', retention: 'user'    } // dies with the tab, also wiped on sign-out
{ storage: 'session', retention: 'browser' } // dies with the tab, survives a sign-out in it
```

`'user'` was made the default at the time, so the safe answer was the one you got
by not deciding, and nobody would write `'browser'` for something private to the
signed-in user. The persisted `r` field changed with the type, since nothing is
published yet; an earlier record reports as unreadable rather than being silently
replaced. Retention is the same choice in the reserved host scope (§24).

**Amendment (2026-09-21):** the default is now `'browser'`. Naming the axis for
who owns a record held up; making the rarer answer the implicit one did not.
Almost everything stored through the boundary is impersonal UI state — a density,
a collapsed panel, a chosen tab — so the safe-by-default rule was mostly spent on
records that nothing owns, and `retention: 'user'` on the few that mattered read as
noise beside it. Per-user data is the explicit choice now: a record that declares
no retention survives a sign-out, and anything derived from a user's data says
`retention: 'user'` where a reader can see it.

---

## 22. The developer tools ship in production and are gated at runtime

**Status:** decided, with a stated cost.

Every other developer-only thing is guarded with `DEV` from `@company/mfe-core`,
which folds to `false` in a production build. `@company/mfe-devtools` deliberately
is not: the page where the panel is most needed is a deployed one, where the
question is which manifest a surface loaded, and `DEV` would delete the answer
there. It ships in every build, gated at runtime on one key read once,
`localStorage["company:mfe:devtools"]`, at the cost of that read and a `null`
return per page load. Everything else is behind a dynamic `import()`, and a test
keeps `src/panel/` out of the barrel: a static re-export would put the chunk back
in the initial bundle and leave the import doing nothing, invisibly. The registry
view moved behind the flag too (§23), and the shell's stylesheet needs an
`@source` line for `packages/*`, since the tools render into the document §17
leaves to the shell — the only UI this framework ships.

---

## 23. The override strip was removed, and nothing replaced it on the page

**Status:** decided, against the previous decision, with the cost stated.

§22 kept the notice strip on the grounds that an override nobody can see is the
phantom bug the override mechanism exists to prevent. It is gone anyway, with the
header's registry action: a band of warning text above every page is a high price
for a rare, self-inflicted condition. What replaces it is weaker, and that is the
point of writing this down — the tools' trigger and Overrides tab are behind the
flag, so a developer who never turned them on sees nothing, and an override
pointing at a dead dev server looks like a broken deployment.
`collectDiagnostics` carries the overrides and any `registry.json` failure into
the bug report, now the only place on the page that says what the shell was
running.

---

## 24. The host page had no storage scope, and the lint allowlist was the evidence

**Status:** decided, load-bearing.

Three shell files were exempted from `mfe/no-raw-storage` by name, each with the
same comment: this state belongs to the page, not to any definition on it.
`bindHost()` and `hostStorage()` are the only ways into a reserved scope,
`HOST_SCOPE`, `'@host'`; the `@` reserves it, because a definition id is
lower-case letters, digits and single hyphens, so no registry entry can claim that
name — where a shell using `"shell"` could not be told from a definition.
`useStoredState` resolves by position, the definition inside a mount and `@host`
outside, as `useCommand` does (§26); the session generation is host-scoped and
`retention: 'browser'` (§25), because the record fencing every
`retention: 'user'` write cannot be gated by what it establishes. The theme is the
one exemption, its key never ours to choose: legacy Angular applications read
`localStorage["theme"]` as a bare string, so `preferences.ts` writes that raw.

**Consequence:** the allowlist is not empty, so what an entry has to prove is what
changed; one that cannot justify itself that way is another missing primitive,
not a local exception.

---

## 25. The runtime adopts the shell's hub, and owns everything else

**Status:** decided, forced by a bug that dropped every diagnostic.

`createMfeRuntime` built its own `DiagnosticsHub`, nothing added a sink to it, and
`report()` returns on its first line when the sink set is empty, so every rejected
override and unreadable record was thrown away while the shell had a Faro provider
all along — the failure class §11 describes, landing on the diagnostics. The hub
is now the shell's and `createMfeRuntime({ diagnostics })` adopts it; ordering
forces that one option, since `installShellAuth` runs before the runtime exists.
`telemetryDiagnosticsSink(provider)` is the one `Diagnostic` to `TelemetryRecord`
translation, forwarded only when the host asks by name (§10). Nothing else is
adopted — the theme is not a framework record (§24) — and `dispose()` removes only
the sinks it added to a supplied hub, silent by design with none.

---

## 26. The host page is a scope, and reading the registry is a selector

**Status:** decided; every disagreement below had already happened.

The shell had invented whatever the framework would not give it: breadcrumbs
registered a made-up definition id and a token `removeMount` could not tell from a
real mount's; the palette hard-coded its own commands; and
`[...entries.values()].filter(…)` was rewritten in the shell's hooks, the settings
sheet and the developer tools, two copies already disagreeing — one flattening
`app.capabilities` so help and release-notes pages were offered as settings, the
active application derived two ways. `HOST_SCOPE` (§24) is the name the page
should have had: `registerHost()` registers in it and `register()` refuses it,
`useCommand` outside a mount registers there, `useBreadcrumbs` outside one at
depth 0, and `useTheme`, `useUser` and `useGroups` stopped requiring a mount,
since the host publishing the theme could not read it back. The reads are written
once in the neutral host. Two limits: `useActiveDefinition` takes the pathname,
because the host owns its router and the navigation bridge never hears a router's
`pushState`; and a selector returning something renderable would be the first UI
shipped outside the developer tools (§22), so they select only.

---

## 27. A host asks the build integration for its share scope instead of writing it twice

**Status:** decided; `@company/mfe-rspack/federation`.

The shell's `rsbuild.config.ts` resolved a share scope of its own, from the same
candidate list and singleton rules `pluginMfe()` already resolves one from for
every container. Two copies of one policy, and the disagreement is silent: the
page loads, then a framework hook inside a remote fails with "rendered outside any
mount", a message about the mount and not the share scope. `hostShared({ root })`
applies that policy to the host's install, and two things differ because a host
provides the modules: it advertises the version it installed, never the range it
declared, and shares what it can resolve rather than what it lists — which is how
`@company/mfe-core`, never a shell's declared dependency, is provided at all.
Resolving none is a build error; individual absences stay legal. It is a subpath,
so a config that wants the share scope never loads the plugin.

---

## 28. Reading a Widget's published inputs is headless, and a test is what keeps it honest

**Status:** decided; the drift had already shipped.

§16 records why the registry carries each Widget's contract. Three readers then
walked that published JSON Schema themselves and drifted: the build's static Zod
reader publishes `const` for a literal and `anyOf` for a nullable, which the
shell's copy, classifying by `enum` and `type` alone, dropped into the raw JSON
box with nothing reporting it. `describeWidgetInputs` is that walk,
once, with `defaultInputsFor`, `coerceInputs` and `needsInputPrompt`. §16's
distinction is in the return type: `null` is "the build could not describe this",
`[]` is "this Widget takes nothing", and a host rendering an empty form for the
first tells the developer something untrue. Core cannot import the build
integration, so `widget-inputs.test.ts` lists every construct `zod-static.ts` can
emit and asserts the kind that comes back: `unknown` means the reflector is behind
the emitter. A host knows event names only as strings, so `DynamicWidget` gains
`onEvent` and `lazyWidget` none (§15).

**Cost:** which control to draw stays in the host, since picking a select for an
enum would ship a control set (§22).

---

## 29. A registry entry names the build it came from

**Status:** decided; the bug report was the only reader that needed it.

§23 left the bug report as the only place on the page that says what the shell was
running, and it could name no build. `BuildProvenance` (`hash`, `time`, meaning
what §19 made them mean) is a named type in the core, the registry entry's `build`
field carries it, and the report lists one line per
accepted entry. It is validated loosely and never rejects the entry — a container
that cannot describe its own build still mounts, but a malformed `build` is dropped,
since a hash that is not a string would reach a bug report as `[object Object]`
and be believed. An entry that named no build says so, because a missing line
reads as a missing container; and it is a list, because the registry is the only
place readable without loading the container.

---

## 30. A host resolves shares against the scope it has, not against every remote it knows

**Status:** decided; the reported defect was "when I can't load an MFE manifest,
the entire page is down".

The framework's central promise is that a registry entry which fails costs the
page that one surface (§11). An override pointing one App at a dead port broke it:
the boundary rendered its `MountFailure`, then the next chunk the shell fetched —
the developer tools — took the whole page down. Module Federation's
default share strategy is `version-first`: before resolving **any** share the host
re-initialises **every** registered remote to fetch its manifest, so one
unreachable manifest rejects its resolution of `react` and of the framework
packages. `hostFederation({ root })` therefore declares
`shareStrategy: 'loaded-first'` alongside the share scope §27 already gave the
host, and they travel together because a host that took one without the other
still loses the page to the first remote it cannot reach. It is declared at build
time, since the runtime stamps it onto every share as the instance initialises.

**Cost:** `loaded-first` keeps the host's copy of a shared module, which
`version-first` let a remote's build replace, so a remote shipping a _newer_
package no longer wins the scope.
