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
it is now `reactAdapter.aroundLoad`, which the runtime runs around React containers'
loads and no others (third amendment). The same
reason gave every definition a neutral `mount`: a host cannot render another
framework's tree, so a definition mounts itself into an element the host provides,
given the host's `MountContext`, and hands back what the host needs to update and
dispose it. React definitions carry it too, so an Angular host can place a React
Widget or App; a React host still renders its own definitions directly and reaches
for `mount` only for the others.

**Third amendment (2026-09-23):** no host branches on framework any more, and no
adapter owns part of a load. The branch the second amendment kept is gone: a React
host places a React definition through `mountDefinition` as it places an Angular one
(§33), so `isReactDefinition`, `isAngularDefinition` and `isMfeDefinition` went with
it, and so did each adapter's own `createMf2ContainerLoader`. The shell hands the
runtime one `createFederationContainerLoader`, and an adapter that needs page state
arranged while its containers evaluate declares it on itself, as
`MfeAdapter.aroundLoad(load, entry)`. The runtime runs it inside the shared loader,
once per load that actually happens and only for entries that adapter parsed, which
is why the TanStack shim no longer runs around an Angular container's load. With the
definition brand an open string and every adapter listed by the shell, an adapter is
a plugin: a third one adds a package and one entry in the shell's `adapters`, and
changes nothing in the core, the runtime or the adapters already there.

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

**Amendment (2026-09-23):** the effect now owns the runtime's handle rather than a
mount of its own. `useOwnedMount` went with the in-tree mount it built:
`useDefinitionMount`'s one effect calls `mountDefinition` (§33), publishes the handle
it returns and disposes it in its cleanup, and a second effect hands each render's
inputs to `update`, which drops an equal set. The token, the context and both roots
are the runtime's, made after an `await` rather than inside React's commit, so a
StrictMode rehearsal disposes the first handle before its load settles and the
definition's `mount` runs once — pinned by `app-host.test.tsx`. The rule is the same
one, held by a handle instead of a context: what an effect creates, that effect's
cleanup ends.

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

**Amendment (2026-09-24):** `events` is published in the same shape as `inputs`,
an object schema with one property per event whose value is that payload's
schema, instead of a list of names. A host wiring Widgets in sequence, one
Widget's event feeding the next one's inputs, has to compare a payload with an
input schema before either container loads, and one shape means one reader:
`describeWidgetEvents` walks each payload with the code `describeWidgetInputs`
uses (§28). A payload the build cannot read is `{}`, "anything", and the name
stays. `events` is absent only when the names themselves cannot be read. A spread
or a computed key in the events map counts as that, since a partial set would
claim to be closed. The host still accepts the old list of names, read as those
events with unknown payloads, so a shell is deployed first and the containers
rebuilt in any order after it, without a contract major.

**Amendment (2026-09-25):** the published fields are `inputSchema` and
`outputSchema`, the names the authored contract now uses (§41), and a Widget's
events are its outputs. The old list of names is no longer accepted: nothing was
deployed, and the field it lived in no longer exists.

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

**Amendment (2026-09-23):** the runtime owns the scope root, and the overlay root
with it. For each attempt `mountDefinition` (§33) creates a `display: contents`
element carrying `data-mfe-scope`, `data-mfe-mount` and `data-mfe-kind`, puts the
definition's element inside it, and hands it on as `MountContext.scopeRoot`; a
definition renders into its element and never adds a root of its own. The React
adapter used to render its own scope root inside the one a host had already made, so
a React definition placed by another host sat under two; now there is one, whichever
adapter built the definition. The build-attached `StyleRoot` still renders inside
it, from the container's own copy of the library, with the context's overlay root as
its portal target.

PrimeNG, which the Nx generator scaffolds into Angular containers (§31), is where
this model stops. Its theme engine writes `<style>` tags into the document head
under fixed names, outside any `@scope`, so two Angular containers on different
PrimeNG versions or presets restyle each other: every Angular container on a page
has to use the same version and preset, and nothing but the generator's pin (19.1.4,
Aura) holds them to it. Its overlays follow `overlayOptions.appendTo`, which the
generated `providePrimeNgForMfe()` points at the mount's overlay root, but Dialog,
ConfirmDialog and Drawer do not read it, and each needs `[appendTo]` set to that root
or it renders on a bare body, outside the container's scope. Its dark mode is a class
the generated providers toggle on the scope and overlay roots, because PrimeNG
compiles an attribute selector to `:root[…]`, which only ever matches `<html>`. And
PrimeNG is never shared through federation, because that engine's style registry is
module state.

**Amendment (2026-09-24):** containers now give PrimeNG no preset, so it declares
none of its variables, and the shell declares them once for the page, keyed on its
own `dark` class on `<html>` (§38). The version still has to match, since PrimeNG
still writes its components' rules into style tags named page-wide; the preset, and
the dark class toggled on each mount's roots, are gone.

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

**Amendment (2026-09-23):** what `hostShared` returns is now scoped (§33). Every
React-bound candidate goes in `react@<the React the host installed>`, and
`@company/mfe-core` and `@company/mfe-runtime` stay in `default`. Those two are read
beside `@company/mfe-react`, where the adapter's own imports resolve, and installed
versions are read by walking `node_modules` rather than through whatever `NODE_PATH`
the bundler runs with — which is also why `recharts`, held only by the design
system's own install, is no longer shared by the shell. The policy is still written
once and applied to both sides. What is new is the other half of the handshake: a
container's build publishes the scopes its shares live in as `shareScopes`, the
registry entry carries them, and the federation loader registers the remote with
exactly those, `default` first. A remote links only the scopes named when it is
registered, so an entry built before scopes shares in `default` alone and keeps its
React to itself.

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

**Amendment (2026-09-25):** the readers are `describeInputs` and
`describeOutputs`, over a `PublishedContract`, and `DynamicWidget`'s catch-all is
`onOutput` (§41). `describeOutputs` does not read `required`: every output may
never be emitted, so whether a property is required means nothing.

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

**Amendment (2026-09-23):** that cost now applies within a scope. Only a container on
the host's exact React version joins the host's `react@<version>` scope (§33), and
there `loaded-first` still keeps the host's copy: a remote shipping a newer
`@tanstack/react-query` runs on the host's, and one whose declared range the host's
copy does not satisfy is rejected by `strictVersion` at load rather than handed a
second copy. A container on any other React version shares nothing with the host
but `@company/mfe-core` and `@company/mfe-runtime` in `default`, where the same rule
holds and the host's copy wins. The strategy is still declared at build time, and
the runtime still stamps it onto every share, in every scope.

---

## 31. Angular containers get an adapter of their own, built by Nx on webpack

**Status:** decided; the build tool at the project owner's direction.

An Angular application cannot render inside a React tree, so a second framework on
the page needed more than a second registry reader. `@company/mfe-angular` is its
adapter: `createApp` and `createWidget` return branded records the build reads
statically, each carrying the neutral `mount` (§6), and each mount is an Angular
application of its own, created with `createApplication` on the page's one browser
platform. It depends on the core and the runtime and nothing else. It is zoneless
and cannot be otherwise: `zone.js` patches timers, promises and event listeners for
the whole page, which `mfe/no-global-patching` forbids every container to do, and
one zone would be shared by every Angular mount and by a shell of any framework.
With `provideExperimentalZonelessChangeDetection()` each mount schedules its own
change detection, and the Angular lint preset rejects `zone.js`, `NgZone` and a
container bootstrapping an application or a platform itself (§34).

The build went the other way from the adapter. `@company/mfe-rspack` stays React's:
it carries the React Compiler, TanStack's route tree and the design system's style
root, and an Angular container uses none of them. Its framework-neutral half moved
into `@company/mfe-build`, which `@company/mfe-rspack` now composes, and
`@company/mfe-nx` composes the same half for Angular: the `app` and `widget`
generators, and `withMfe()` as the `customWebpackConfig` of Nx's
`@nx/angular:webpack-browser`, producing a Module Federation 2 remote through
`@module-federation/enhanced/webpack`. Not Rspack: Angular's esbuild builder has no
Module Federation 2 support, and the releases of Nx's Angular-on-Rspack integration
that accept Angular 19 require Rspack 1, which this repository has left for
Rspack 2. The webpack builder is the one Angular itself ships, so a container's
ahead-of-time compilation is Angular's own. Nx 23's Angular plugin requires Angular
20, so the generator accepts Nx 20 to 22 and refuses anything else before writing a
file.

A component library is a container's decision, so none is in the adapter, and `pnpm
boundaries` rejects `primeng` there. The generator scaffolds PrimeNG 19.1.4 with the
Aura preset into the container's own `src/primeng.ts`, built only on seams the
adapter offers every library: a definition's `providers`, the mount's `scopeRoot`
and `overlayRoot` from `injectMfeMount()`, and `injectTheme()`. PrimeNG is never
shared through federation, and `withMfe({ shared })` refuses it: its theme engine
keeps the page's style registry in module state, so a shared copy would let one
container's preset restyle another's components.

**Cost:** PrimeNG's global styles are unscoped (§17), so every Angular container on
a page has to use the same PrimeNG version and preset, which only the generator's
pin holds. Dialog, ConfirmDialog and Drawer need an explicit `appendTo` pointing at
the mount's overlay root. Every Angular container downloads its own PrimeNG. The
zoneless provider is still experimental API in Angular 19, and a plain field mutated
from a timer does not render. Signal `input()` and `output()` run only in a
container's ahead-of-time build, because the adapter's own suites compile just in
time. And the packages ship TypeScript source, which a consuming Nx workspace has to
add to its container's `tsconfig` until they ship compiled output.

**Amendment (2026-09-23):** the developer's runtime configuration moved out of
`public/` into `.mfe/runtime-config.json`, `.mfe/<runtimeConfigFileName>` when renamed.
Three reasons. Developer values, such as a localhost API, no longer sit in a folder a
build deploys: both bundlers copy `public/` into their output, and `.mfe/` is copied by
neither. Keeping the old file out of production took a guard in each integration (the
generator's production-assets `ignore`, the webpack plugin's overwrite of the copied
asset, the Rsbuild skip), and a guard can miss: `withMfe({ runtimeConfigFileName })`
renamed the file the build shipped but not the `ignore` the generator had already
written into `project.json`, so a renamed file's local values reached production. And
the per-integration code is gone: one middleware in `@company/mfe-build` answers the
container's usual `runtime-config.json` URL from `.mfe/` in both dev servers, ahead of
their own serving, so container code is unchanged and a production build ships only the
declared defaults by construction. The costs: the one file in a build-managed directory
that is committed needs an exception in both the container's `.gitignore` (`.mfe/*`,
not `.mfe/`) and the generated `.mfe/.gitignore`; a generate command reads no bundler
configuration, so a renamed file is created by hand and committed once with
`git add -f`; and a copy left in `public/` is moved once by the next generate run, or
reported, because it can now ship, when both exist.

**Amendment (2026-09-24):** the generated `src/primeng.ts` no longer carries a preset
or binds dark mode, and `@primeng/themes` left the generated dependencies: the host
declares PrimeNG's variables for the whole page before the first Angular container
mounts (§38). `injectTheme()` and the mount's roots are still what a container's own
theming code would build on.

---

## 32. `@company/mfe-host` is `@company/mfe-runtime`, the core holds contracts only, and an application imports only its adapter

**Status:** decided; enforced by lint and by `pnpm boundaries`.

The package was named for its first consumer. Once every definition mounts itself
through it (§33) and every adapter's `/host` re-exports it, it is what both sides of
a mount run on, so it is `@company/mfe-runtime`, and its names followed:
`createMfeRuntime`, `MfeRuntime`, `MfeRuntimeHandle`, `createMemoryRuntime`. The
core went the other way. `MountLifecycle`, `withDeadline`, `DiagnosticsHub` and the
listener sets were stateful code in the package the build layer also imports, and a
second place a page's state could live. They moved into the runtime, their types
stayed, and a lint zone keeps `@company/mfe-core` to types, constants and pure
validation: no exported class other than an error, no top-level mutable binding or
collection, no timer and no browser global outside its tests.

An application — a shell, a container, an example or a generated project — imports
only its adapter: the root for container code, `/host` for booting a shell,
`/testing` in tests and `/registry` for the adapter alone. Every `/host` is
`export * from '@company/mfe-runtime'` plus that framework's provider, `MfeProvider`
or `provideMfeRuntime`, so a name a shell needs has one import path on either adapter,
and `tools/interop` asserts the two surfaces match. The re-export names the bare
specifier, because only that is a federation share key: a subpath would bundle a
second runtime. `/registry` imports no framework, so a React shell reads Angular
entries through `@company/mfe-angular/registry` without resolving Angular. Both
author presets and the neutral `application()` preset reject the core and the
runtime in application code, with a message naming the adapter entry to use.

**Cost:** everything the runtime exports is public API of both adapters, and a
runtime change changes both surfaces; the parity test keeps them equal, not small. A
shell reading Angular entries depends on the Angular adapter's package, if not on
Angular. The rename broke every import of `@company/mfe-host`, pending changesets
included. And the shell's boot file still imports the Module Federation runtime
directly, exempted by name.

---

## 33. Every host mounts every definition through one path, and each framework version shares in a scope of its own

**Status:** decided; `mountDefinition` in `@company/mfe-runtime`, the scopes in
`@company/mfe-build`, and two React versions on one page proven in `tools/interop`.

§6's second amendment left two ways to place a definition: a React host rendered
React definitions in its own tree and called `mount` for the rest, and an Angular
host did the reverse. Each kept its own loading, retry, input equality and scope
root, and they had drifted: a React definition placed by another host sat under two
scope roots. There is now one path. A host renders an empty element and calls
`mountDefinition`, and the runtime does the rest for every adapter. It resolves the
definition through the loader, which shares a load in flight and never keeps a
rejection. It creates the scope and overlay roots (§17) and calls `mount` after an
`await`, never from inside a host's render. It retries only from the error state and
drops an input set equal to the last. It reports a payload the host's contract
refuses rather than throwing it, disposes a nested mount with its parent, and tears
down in order: the definition first, then its context. Load, mount and disposal run
under `runtime.deadlines`, 30, 30 and 5 seconds by default. A React definition opens
a React root of its own, with `useId` prefixed by the mount token. A failure before
its first commit rejects the mount, and one after goes to `target.onFailure`.

One path exposed a bug neither had seen. The browser bridge hears only `popstate`,
and the shell's router writes the page's history itself, so a navigation from the
palette, the settings sheet or a breadcrumb moved the URL under a mounted App that
never heard of it. `BoundaryNavigator.announce()` tells the navigator's subscribers
where such a navigation left the page, and nothing when they already know. The shell
calls it after each navigation of its router, as `mfeRoute` and a routed
`<mfe-app-host>` do for theirs.

Own roots made several React versions on one page possible, and Module Federation's
one `default` scope could not hold them. A strict singleton throws on the second
version. Sharing each package at its own version fails quietly instead: a shared
module's own imports resolve in whichever build provided it, so a host-provided
adapter binds TanStack Query to the host's copy, and a container whose own copy
resolved elsewhere finds no `QueryClient`. So each framework shares in a scope named
after its exact installed version, `react@19.3.0` or `angular@19.2.25`, and inside
it the old rule stands: one strict singleton per candidate, and every React-bound
package in the React scope, singleton or not. Containers on one version share one
copy, and a container on another brings its own complete set. `@company/mfe-core`
and `@company/mfe-runtime` stay page singletons in `default`, because the
mount-token sequence is module state, errors and spans are recognised by
`instanceof`, and neither imports a framework, so pinning them pins no container's
React.

**Cost:** React context, Suspense and a host's error boundaries no longer reach into
a container. The adapter provides its own again in each root, `AppHost` shows
`pending` instead of suspending, and a render error inside a container reaches the
host as the mount's error state, through `onFailure`, rather than bubbling through
its tree. A dashboard of Widgets opens one React root per Widget, which has not been
measured. A React container slower than the load deadline now fails with
`load/timeout` where it used to wait. A container on another React version brings
its own `sonner`, so its toasts never reach the shell's `Toaster`. `strictVersion`
inside a scope still rejects a container whose version of a scoped package the
loaded copy does not satisfy, a minor apart included. `recharts` is no longer shared
by the shell. And `shareScopes` couples the registry to the build: an entry without
it shares in `default` alone and runs on its own React.

---

## 34. The lint plugin has a neutral root and one subpath per framework

**Status:** decided.

One package, one plugin object and one `mfe/` rule namespace, in three entries. The
root holds the five rules — the four, plus `mfe/no-widget-global-router`, their
Angular Router counterpart — the package zones, the repository's `framework` and
`tooling` presets, and `application()`, the import boundary any application gets
(§32). `./react` holds `author()`, as before. `./angular` holds `angular()`: the
Angular author preset, with angular-eslint's recommended rules and the zoneless and
application-ownership bans (§31). Each shared rule takes options naming its
adapter's APIs, so an Angular author reads `injectMfeSignal()` in a message where a
React author reads `useMfeSignal()`.

The framework lint plugins — React Hooks, the two TanStack plugins and the three
angular-eslint packages — are optional peers, loaded when a preset is built, never
when an entry is imported. So an Angular workspace never installs React tooling, and
a missing peer throws one error naming every package to install. The Angular preset
uses the individual angular-eslint packages rather than the meta package, which
peers on the Angular CLI. It lists the recommended rules of angular-eslint 22.5
itself rather than spreading them, because that set spans later Angular versions
than this adapter targets. It accepts angular-eslint 19 to 22, and 22 is the line
that runs on this repository's ESLint 10.

**Cost:** the hand-listed Angular rules drift from angular-eslint's own until
someone copies them again. `application()` replaces another preset's
restricted-import rule for the files it covers rather than adding to it, so a config
that uses it restates the bans it still wants, as the root config does for vendor
telemetry. And the `framework` preset still needs the React Hooks plugin, because it
lints the React packages.

---

## 35. A shortcut is a field on a command, and the runtime reads the keys

**Status:** decided; forced by §33, which gave every mount a React root of its own.

The shell's keys lived in the design system's shortcut registry, handed down through
a `ShortcutsProvider` so that mounted Apps could register into it. Once every
definition mounts through `mountDefinition` into its own root, no App can reach that
context, and the registry was left serving the shell alone. A second registry beside
the command registry would also have been a second list for the palette and the help
sheet to merge. So `CommandRegistration` gains an optional `shortcut` — a chord such as
`'mod+s'` or a sequence such as `'g r'` — and the command registry, which every adapter
already reaches through the runtime, reads the keys. The host installs one `keydown`
listener and calls `commands.handleKeyDown(event)`; a match runs through the same path
as `execute`, so `canExecute` still decides and a denial still reaches the user. The
parsing and matching carry over the design system's: `mod` is ⌘ on Apple platforms and
Ctrl elsewhere, a sequence waits one second for its next chord, a symbol matches with
or without Shift, and an unmodified key typed into a field stays typed — including one
React Aria re-dispatches from a focused field onto an option, which the shell used to
guard against itself.

Whose keys are live is derived from what the runtime already knows. The host page's
shortcuts fire everywhere and are reserved: a container shortcut that equals, begins
or extends one of them is ignored with a warning, and loses the keys if the host page
claims them later. An App's fire while the navigator's pathname is inside its boundary.
Nested Apps are both live, since the page is inside both, rather than only the inner
one, because the registry sees mounts only through their commands and an inner App
that registers nothing would otherwise hand its keys back to the outer one. A Widget's
shortcut is ignored with a warning, as a Widget does not own the URL or the head
(`no-widget-global-effects`).

Two registrations that could be live for the same key press — two in the host page,
two in one mount, or two Apps whose boundaries nest — are reported when the second is
declared, and a press that could mean either runs neither and is not prevented. The
alternative, first registration wins, would have made the outcome depend on mount
order, which a reader of the page cannot see. Two Apps at unrelated boundaries may use
the same keys.

**Cost:** `CommandRegistry.register` now takes the owner — `{ definitionId, mountToken,
kind, basePath }`, which a `MountContext` already is — instead of the id and token, so
the registry can tell an App from a Widget and knows the boundary. Shortcut errors and
warnings reuse `command/duplicate-name`, which already covered an invalid registration,
rather than widening the closed union (§7). And a key the page is inside two nested
Apps for is ambiguous where an inner-wins rule would have resolved it.

---

## 36. The shell signs in before anything loads, and holds its tokens in memory only

**Status:** decided; the shell's half of §10.

The shell has no server, so sign-in is an OIDC authorization code flow with PKCE run in
the browser by `oidc-client-ts`, and it runs first: `index.tsx` calls `authenticate()`
and imports the boot only when it resolves `true`. A visitor who is not signed in
leaves for the identity provider from the entry chunk, before React, the registry or
any container is fetched, so nothing behind sign-in is ever loaded for them. There is
no per-route authorization; the whole page is behind one gate. Server rendering was
considered and rejected: the micro-frontends are most of the page and mount in the
browser regardless, and redirecting before the entry has done anything else is what
makes sign-in fast.

**The session lives in `sessionStorage`, and dies with the tab.** Tokens were first
held in memory only, which sent every reload back through the provider; `sessionStorage`
lets a reload restore the session, renewing it through the refresh token when it is
within 30 seconds of expiry, without that round trip. `localStorage` was weighed and
left: it would spare a new tab and a restarted browser the round trip too, but it keeps
a refresh token on disk for days, shares one across tabs, and hands a shared computer's
next user the last one's session. The session sits under `shell.oidc.session.` and the
sign-in request's `state` and PKCE verifier under `shell.oidc.request.`, apart because
clearing stale requests removes every key under that prefix it cannot read; this is why
`apps/shell/src/auth/gate.ts` is in `storageAllowedScopes`.

**A duplicated tab signs in for itself.** Duplicating a tab copies its `sessionStorage`,
refresh token included, and two tabs rotating one refresh token retire each other's,
which a provider with reuse detection answers by ending the session for both. Each tab
therefore holds a Web Lock named after an id in its own `sessionStorage` (`shell.tab`)
for as long as it lives; a copy finds the lock taken, drops the copied tokens and signs
in fresh, which the provider's own session makes immediate. Without Web Locks a copy
cannot be told apart, and a refused rotation ends in a fresh sign-in. So each tab holds
its own refresh token and the rotation hazard §10 guards against never spans tabs;
within a tab, `createOidcTokenSource` makes renewal
single-flight, renews a token within 30 seconds of expiry rather than sending it, and
answers a caller whose rejected token was already replaced with the new one. Renewal is
the refresh token grant only; when it fails the session is lost and the page navigates
to sign in again, back to where the user was.

The redirect URI is `/`, the one path the shell owns outright, so a callback is
recognised by `code` or `error` with `state` there. The return path travels as the
request's state and only a path on this origin is honoured. The ID token's claims fill
`shellState.user` and `groups` (the claim named by `OIDC_GROUPS_CLAIM`).

**The configuration is read at run time, not built in.** One build serves every
environment: the shell declares its five values in `src/mfe.config.ts` and reads them
through the framework's `#mfe/config`, in its Zod-free form for a host (§37), and a
deployment writes `/runtime-config.json` from the `OIDC_*` environment variables with the
generated `runtime-config.sh`, exactly as it does a container's. `resolveAuthConfig`
decides what the values mean. `index.html` preloads the file, so it downloads beside the
entry and the entry's fetch is answered from that one request, and `#mfe/config` is
imported eagerly, so it is no chunk of its own.

**Sign-in off is written down, never inferred.** `OIDC_DISABLED=true` turns it off and
the shell runs as the development user with development tokens. A development build
with nothing configured does the same; a production build with nothing configured
refuses to boot and says why, and one with only half a configuration always does. The
user menu says "Sign-in is off" rather than hiding the sign-out entry.

**The loading screen is in `index.html`**, painted before any stylesheet or script is
fetched, so it cannot use Tecton's classes: each colour names the Tecton token first and
falls back to that token's own value for the mode. Its drawing is a canvas custom element
from the scripts in `src/loaders/`, chosen by the `loader` export of `src/mfe.config.ts` (or
`cycle`, the next one on each page load) unless a deployment sets `SHELL_LOADER`: the build minifies every one of them into the page, and an inline script
reads the runtime configuration and runs only the one it names, or the declared default.
A directory of loaders is a family that shares a `kit.js`, inlined once, so the 39 oil-and-gas scenes carry one worker and one set of helpers between them. Inlining all of them costs every load the bytes of the loaders it does not draw (about 60 kB gzipped for the page with 47 loaders in two families); fetching
the chosen one instead would wait for a second download before anything moved. The
configuration is read with a request of its own, because taking the preload would send the
entry's read back to the network. Each loader draws in a worker through an `OffscreenCanvas`,
so it keeps its frame rate while the entry parses and boots on the main thread, and the boot no longer shares that thread with it:
under a 4× CPU throttle the shell was ready in 2.8–3.4 s rather than 4.4–5.1 s with the well log drawn on the main thread. It fades out once React commits the first frame, as the shell fades in beneath it. The loading screen stays up for a minimum time once drawn (`loaderMinDuration`, a second), and a boot faster than that waits, hidden, until it has passed: a fast load is a moment slower rather than a flash of a drawing that is gone before it reads. The choice and the minimum are plain exports of `src/mfe.config.ts`, built into the page, rather than runtime settings with defaults: generating seeds a development copy of the runtime configuration with every declared default and never changes a value it seeded, so an edit to a default would never reach a developer's page. `SHELL_LOADER` stays, without a default, for a deployment to choose another.

**Cost:** the refresh token sits in `sessionStorage` until the tab closes, so script
running in the page could read it for that long rather than only use it; DPoP, where the
provider supports it, would bind it to a key that cannot leave the browser. A new tab
still costs a round trip through the identity provider, and one that issues no refresh
token sends the user through it again every time the access token expires. Without a server-side session the shell cannot end a
session early; revocation takes effect at the next renewal, so access tokens should be
short-lived. `oidc-client-ts` adds about 17 kB gzipped to the first load, fetched in
parallel with the entry.

---

## 37. A host's `#mfe/config` validates without Zod; a container's still runs the author's schema

**Status:** decided; forced by §36.

A host reads its runtime configuration before anything else on the page loads, sign-in
included, so whatever that read imports is on every visitor's first paint. The container
`#mfe/config` validates through the author's Zod schemas, which would put Zod there. The
build already reads each schema without running it, into the JSON Schema the deployment
validates against, and refuses any it cannot read that way (`zod-static.ts`). So a host's
generated module checks each value against that JSON Schema with `checkConfigField`, a
dependency-free check exported from the browser-safe `env` subpath, and imports the
declarations with `import type` only: `MfeConfig` is still inferred from the Zod schemas, and
the bundler erases the import. The shell's first paint carries no Zod.

`planHostConfig` builds the host's files from the same declarations and the same generators
a container uses: `runtime-config.json` defaults (shipped by a build), `runtime-config.sh`,
`.env.example` and the JSON Schema, and the dev server serves `.mfe/runtime-config.json`.
`pluginMfeHostConfig()` and `mfe-generate --host` are its Rsbuild and command-line faces. A
container's output is unchanged, byte for byte.

For the two to accept the same values, the static reader now also records what JSON Schema
cannot say: the string transforms (`trim`, `toLowerCase`, `toUpperCase`) and `z.coerce`. A
suite runs one set of samples through Zod's `safeParse` and through `checkConfigField` and
requires the same verdict and the same value.

A host's module differs from a container's in two small ways, both for the host document:
it fetches with same-origin credentials and the default cache, so a `<link rel="preload"
as="fetch" crossorigin>` answers it, and it reports a 200 that is not JSON, which a
single-page fallback serves for a file it does not have, as a missing file.

**Cost:** an object nested in a host's configuration refuses a key its schema does not
name, as the JSON Schema says, where Zod would strip it; top-level unknown keys are refused
by both. The string transforms apply to a top-level field only.

---

## 38. The shell loads what every Angular container shares, before the first one mounts

**Status:** decided.

Every Angular container relies on three things none of them ships: PrimeNG's design
tokens, Open Props and the Material Symbols Rounded font. None of them fits a
container's own stylesheet. The tokens switch with the `dark` class the shell puts on
`<html>`, which is outside every `@scope`, and a scoped stylesheet may not name `html`
(§17). A font file emitted by each container downloads once per container. And a copy
per container of values that are meant to be one per page can drift.

So the host supplies them, through the adapter. `createAngularAdapter({ pageAssets })`
in `@company/mfe-angular/registry` runs the host's `pageAssets` inside `aroundLoad`,
once per page and in parallel with the first Angular container's own download, and
every Angular load waits for it. A load is part of a mount's `pending` state, so the
host shows its loading state meanwhile and no Angular definition paints before the
assets have arrived. A rejection fails the load that was waiting, with
`load/entry-failure`, and is forgotten, so the host's retry loads them again. Every
host path and every preload goes through a load, so an Angular Widget inside a React
App waits exactly as a routed Angular App does. The adapter still names no UI
library: what the assets are is the host's function.

In the shell that function lives in `apps/shell/src/angular/`, which also builds the
adapter `boot.tsx` lists. It imports `angular.css` dynamically, so Rsbuild emits it
as a stylesheet chunk of its own, with the font as a hashed file beside it, fetched
only there, and waits on `document.fonts.load()`, because a declared font does not
download until text uses it and an icon would paint as its name. `angular.css` is one
`@import` per part — the PrimeNG tokens file, Open Props, Material Symbols — and the
packages' versions are in the catalog, so a part is swapped or dropped in one line.
They are page-wide on purpose, and owned by the one thing that is on the page once:
a new version ships as a shell release.

Containers give PrimeNG no preset. With none, PrimeNG declares no `--p-*` variable at
all and its components' rules only read them, so the shell's tokens file is the only
declaration and there is no injection order or cascade layer to arrange. The tokens
file keys its blocks on the selectors the design system uses — `:root`, `.light` and
`[data-theme="light"]`; `.dark` and `[data-theme="dark"]` — and declares every token
in both, since a reference resolves on the element that declares it. That retired
`redeclaredForScopedDarkMode` and the dark class the generated providers toggled on
each mount's roots.

Three Open Props files stay out, because page-wide they would change the shell:
`fonts` declares `--font-sans`, `--font-mono` and `--font-serif` outside any cascade
layer, where the design system declares them inside one; `animations` defines
keyframes named `spin`, `ping`, `pulse` and `bounce`, as Tailwind does, and a
keyframes name is page-wide; `media` is `@custom-media`, which a browser ignores. Its
shadows follow `prefers-color-scheme`, so the three values its dark variant changes
are declared again under the shell's own dark selectors. No other Open Props name is
one the design system or Tailwind declares.

**Cost:** the tokens file and the PrimeNG version agree only by inspection: a
variable a newer PrimeNG reads and the file lacks leaves that part of a control
uncoloured, and a host that passes no `pageAssets` leaves every PrimeNG control so.
Every Angular container on a page still uses one PrimeNG version. The tokens and
Open Props are visible to React mounts too, harmlessly, since no name is shared. The
first Angular load waits for the whole stylesheet (about 31 kB compressed with the
placeholder tokens) and the font (373 kB) even when its container uses neither.
`pnpm verify:page` checks that the tokens and the font were in place when PrimeNG's
first button was inserted, that the tokens follow the dark class, and that a page
with no Angular container never loads them.

---

## 39. Commands are actions, and placements do not decide an action's keys

**Status:** decided; the first step of the agentic plan (`agentic-plan.md`).

A registration is a typed operation that any caller runs: the palette, a shortcut, the
App's own button and, next, an agent. "Command" read as a palette entry, and in CQRS as
a write only, where reads (fetch the selected records) matter as much. So
`CommandRegistration`, `CommandEntry`, `CommandRegistry`, `useCommand`, `injectCommand`
and `runtime.commands` are `ActionRegistration`, `ActionEntry`, `ActionRegistry`,
`useAction`, `injectAction` and `runtime.actions`; the placement `'command-palette'` is
`'palette'`, and the error code `command/duplicate-name` is `action/duplicate-name`.
Nothing is deployed, so there is no alias. The surface keeps its name: the shell's
command palette lists applications, pages and actions, and is built from the design
system's `Command` component. §26 and §35 are unchanged but for the names.

`placements` says which surfaces list an action, and nothing else. An action's keys
work whatever it lists, `[]` included: the shell's actions that open the palette, the
developer tools and the dashboard list nowhere, since the palette is the one or
reaches the others as destinations, and each says why beside its empty list. Once
`'agent'` is a placement that "listed nowhere" is a decision each action states,
rather than a keys-only constant that would also hide it from the agent unnoticed.

**Cost:** "action" is taken twice nearby: React 19 calls an async transition an
Action (`useActionState`, `<form action>`), and the design system has an `ActionBar`.
The docs say "action" for ours and name the others in full where both appear.

---

## 40. Every caller runs an action through one executor, and says who it is

**Status:** decided; step 1 of the agentic plan.

The registry ran an action itself, between registration bookkeeping and shortcut
matching. The agent needs more steps between "may it run" and "run it" — validate the
input, ask for approval, hold a write while another runs — and a record of who acted
afterwards, and each step must hold for every caller or the agent gets a path the
palette does not. So running moved into `action-executor.ts`, as ordered steps:
decide (`canExecute`), then execute. Validating the input, approval and serializing
writes land between them, and audit after, each in the commit that adds the field it
reads; the registry keeps scopes, entries and keys, and hands the executor every run,
from `execute` and from `handleKeyDown` alike.

`execute(id)` became `execute(id, { caller })`, with `caller` one of `'palette'`,
`'shortcut'`, `'ui'` and `'agent'`, required so no caller is recorded by default. A
key press states `'shortcut'` itself. An `executed` result carries the `value`
`execute` returned, once awaited, so `ActionRegistration.execute` is `() => unknown`
where it was `() => void | Promise<void>`. The call takes no `input` yet: it arrives
with `inputSchema`, so there is never a path that hands an action unvalidated input.

A denial goes back to every caller in the result, and to `notifyActionDenial`, which
carries the caller, only when a user asked. An agent's denial is not also a toast: the
agent tells the user in its own words, in the chat.

**Cost:** every caller names itself, which the palette's one call site and the tests
had to learn, and an action's `execute` may now return anything, which no reader
checks until `outputSchema` exists.

---

## 41. A Widget's contract is `inputSchema` and `outputSchema`, and its events are outputs

**Status:** decided; step 2 of the agentic plan.

Actions (§39) take an `inputSchema` and return a value described by an
`outputSchema`: the names TanStack AI, the AI SDK, MCP and WebMCP give a tool's
two schemas. A Widget's contract used `inputs` for the schema, which is also the
name of the values `render` receives, and `events` for a plain record of payload
schemas. So a Widget now declares the same two fields. `inputSchema` is unchanged
but for its name. `outputSchema` is one `z.object` with a property per output,
each that output's payload schema, which is the shape the registry already
published (§16's amendment), so the authored and the published contract are one
thing and the build, the provider boundary and the Angular check read one schema.
"Event" left the vocabulary with it: a Widget emits outputs, as an Angular
component does through its `output()`s. `emit(name, payload)` and the `onX` props
stay, as Angular keeps "emit" and event binding for its outputs. So:
`DynamicWidget`'s `onEvent` is `onOutput`, `<mfe-widget>`'s `(event)` is
`(output)`, the error code `contract/event-mismatch` is `contract/output-mismatch`
with direction `'output'`, the testing helpers' `events` are `outputs`, and the
generated contract module exports `inputSchema`, `outputSchema`, `Inputs` and
`Outputs`. Nothing is deployed, so there is no alias.

The two `outputSchema`s differ in what they describe, following from the kind: an
action's is the one value a call returns, a Widget's has a property per output,
each emitted any number of times, or never, while it is mounted. So no reader of
a Widget's `outputSchema` looks at whether a property is required, and the
agentic plan's rule holds where the two meet: a Widget's `outputSchema` is never
a tool's `outputSchema`.

The plan's other half of this step, moving the build's schema reader into a
neutral module for actions and routes, was not needed. The reader is already
neutral (`config/zod-static.ts`, `readStaticSchema`); what stays in
`widget-contract.ts` is finding the two fields in `createWidget`'s options. An
action's schema is a live Zod object in the page, which the chat host converts
at run time, so the build never reads one, and published routes (the plan's D)
call `readStaticSchema` directly.

**Cost:** `outputSchema` must be a `z.object`, so a Widget that emits nothing
writes `z.object({})` where it wrote `{}`, and `createWidget` refuses anything
without a `shape`. Typing an output's payload reads through the shape
(`z.infer<(typeof outputSchema)['shape']['acknowledged']>`), which the generated
`Outputs` type spells out so a consumer never has to.

---

## 42. An action declares what the agent needs, and the executor checks it for every caller

**Status:** decided; step 3 and feature A of the agentic plan.

An action becomes a tool the shell's agent can call, so it declares what a tool
definition holds, in the names one uses: `description` (for the model; `label`
stays the menu text), `inputSchema` (one `z.object`, the field a Widget's contract
has) and `outputSchema` (the one value a call returns). It also declares its risk:
`effect` is `'read'`, `'write'` or `'destructive'`, undeclared counting as
`'write'`, and `needsApproval` is a boolean or a check of the input. `parallelSafe`
lets an agent's write run beside another, and `followUp: false` tells the agent to
stop once it has the result. `'agent'` is a placement, and one of the defaults, for
a Widget's actions as for an App's: anything a user can reach from the palette, the
agent can reach too, and an action that should not be offered lists its placements.

The executor's steps (§40) gain what they read. Every caller's input is parsed with
the `inputSchema` (absent is `z.object({})`), and a mismatch returns `invalid`,
reported with `contract/input-mismatch`, without running; `execute` receives what
was parsed. A value that fails the `outputSchema` fails the run with
`contract/output-mismatch`. For an agent's call alone, the executor refuses an
action not placed for the agent, then rules on approval: a read runs, anything else
asks, unless `needsApproval` says otherwise, and the host's `actionApprovalPolicy`
may approve, deny with a reason, or ask instead. Asking goes to the approver the
chat sets with `actions.setApprover`; with none, the call is denied rather than run,
and a user who says no returns `declined`. An agent's writes then run one at a time,
unless `parallelSafe`, and a call that waited is looked at again before it runs, so
a mount that went away returns `unavailable` and a `canExecute` that changed denies.
A user who runs an action is its approval, and a user's run may itself run another
action, which a queue would deadlock, so neither step applies to the palette, a
shortcut or the App's own UI.

`useAction` and `injectAction` return a run with the caller `'ui'`, so the App's own
button shares validation, approval and audit with every other caller, and the result
is typed by the action's schemas. The published entry carries `description`,
`effect`, `followUp` and both schemas as JSON Schema, converted by the schema's own
`toJSONSchema` (the container's Zod, not the runtime's) only when its identity
changes, and `actionEntryEqual` compares all of them, so a changed description
reaches the agent's tool list and an equal schema declared again inline publishes
nothing. A schema JSON Schema cannot express is refused at registration, since the
agent could not call the action.

Actions still live in the page and last as long as their mount: they are not server
actions and cannot run headless, and `canExecute` is still a read of UI state, never
an authorization boundary. The server authorizes.

**Cost:** an action with no declared effect asks before the agent runs it, so the
shell and the examples mark their panel openers and navigation `'read'`; a schema
declared inline is converted again on every commit; and an action's type carries two
parameters, erased where the registry stores it.

---

## 43. An action's failures each have a code of their own

**Status:** decided; amends §35's cost.

Every failure the action registry raised carried `action/duplicate-name`: a duplicate
name, an invalid name, label, placement, effect, shortcut or schema, a shortcut it
refused, and a run of an action that had gone away. §35 reused the code rather than
widen the closed union (§7), when shortcuts were its only addition. §42 added the
effect and the schemas, and an agent reads `unavailable` as "list the tools again", so
a code that names a fifth of its cases now misleads both the reader and the code that
branches on it. The union widens, deliberately:

- `action/duplicate-name` — two registrations of one name in a scope, and nothing else.
- `action/invalid-registration` — a field the registry cannot accept, thrown at
  `register` or `update`: the name, the label, a placement, the effect, a shortcut it
  cannot read, an `inputSchema` that is not a `z.object`, a schema JSON Schema cannot
  express, or `register` given the reserved host scope.
- `action/shortcut-refused` — a warning that a shortcut will not fire: a Widget's, one
  the host page uses, or one another live action claims.
- `action/unavailable` — a run of an action no longer registered, from `execute` or
  after an agent's call waited while its mount went away (which reported `mount/failure`).

**Cost:** three more codes in the union, each with a row on the error codes page.

---

## 44. A disposed mount is cleared from every store at once

**Status:** decided; step 6 of the agentic plan.

The action registry, the navigator's blockers and the breadcrumb store each keep
records per mount. Disposing a mount cleared the first two, while a mount's crumbs
went only when the component that contributed them ran its cleanup, so for a moment,
or for good if that cleanup never ran, the trail still named a mount that was gone.
The agent-context store (plan B) will be the fourth such store, and a snapshot of a
disposed mount's selection is context the agent would act on.

So each store has `removeMount(token)`, and `mountScopedStores(runtime)` in
`mount/mount-context.ts` lists them; disposal clears every one before it aborts the
mount's signal, as it cleared actions before. A handle whose records `removeMount`
already took does nothing afterwards, so the owner's late cleanup cannot publish
again. There is still no generic store: what the three share is `removeMount`, not
their logic. A test lists every runtime member with a `removeMount` and fails when
one is missing from the list, so a new store cannot be forgotten.

**Cost:** one more list to keep, which the test keeps honest.

---

## 45. Apps, Widgets and framework packages never import an agent library

**Status:** decided; step 7 of the agentic plan.

The shell's chat is the one place that talks to the agent (plan E). A hook from an
agent library inside a mount could not reach it anyway, as every mount renders in a
root of its own (the wall §35 hit with shortcuts), and a container that bundled one
would be rebuilt with every change to it and would add it to the shared scope. What a
mount offers the agent is its actions, through `useAction` or `injectAction`.

So the author presets (`react.author`, `angular`) and the `framework` preset, in every
package zone, reject the AI and agent libraries and the model providers' SDKs, type
imports included: `ai`, `openai` and `langchain` as exact paths, and `@tanstack/ai`,
`@tanstack/ai-*`, `ai/*`, `@ai-sdk/*`, `@ag-ui/*`, `@copilotkit/*`,
`@anthropic-ai/*`, `openai/*`, `@google/genai`, `langchain/*`, `@langchain/*` and
`@mastra/*` as patterns. The bare names are paths because, as a pattern, `ai` would
match any import whose last segment is `ai`, `./ai` included. The `application()`
preset, which the shell uses, leaves them allowed: E confines the library to the
chat module there. A team's own backend is not linted by these presets and may use
whatever it likes.

**Cost:** a list of package names to keep current as libraries appear; one that is
missing is let through, not refused.

---

## 46. What the agent knows of the page travels with each turn, and goes with its mount

**Status:** decided; feature B of the agentic plan.

The agent acts on what the user is looking at, so each turn carries it, in the layers
Agent-Native's context awareness uses. `runtime.agentContext` (`AgentContextStore`)
holds them, and `read()` assembles them when a turn is sent:

- **The URL.** The page's path and search params, and every mounted App whose boundary
  holds the page with its own path below it, outermost first. The mount context records
  each App's boundary as it creates it, so no author does anything, and filters worth
  sharing belong in the search params, where the agent sees them and changes them by
  navigating.
- **Selections.** `useAgentContext({ description, schema, value })` and
  `injectAgentContext` publish a small snapshot of what is selected or focused, as
  CopilotKit's hook of the same name does: `description` tells the model what the value
  is, the schema parses it, and what it parsed is what the agent gets, with a
  `capturedAt` that changes when the value does. It must be JSON of at most 4096
  characters: ids and a label, never whole records and never secrets. A value that is
  not is left out and reported once, as a warning with `contract/input-mismatch`. The
  agent reads the records themselves through the App's read actions (§42), so it acts
  on live data rather than on a copy taken at render.
- **Prompt handoff.** `useAgentPrompt()` and `injectAgentPrompt()` return a function
  that hands `{ message, context, submit }` to the chat, so a click becomes a turn:
  `message` is shown, `context` is sent but not shown, and `submit: false` fills the
  composer for the user to review. It answers whether a chat took it; until the shell
  has one (E), none does.

A selection belongs to its mount, as an action does, and the store is on the list of
mount-scoped stores (§44), so disposing a mount takes its selections and its boundary
with it, and the agent never acts on what a gone mount had selected. Outside a mount it
is the host page's own. Sending the page's selected text with ⌘I is the chat's own
input, and lands with it in E.

**Cost:** a mount states its selection twice, in its own state and in the snapshot,
and the size limit refuses a large value where truncating it would have sent something.
