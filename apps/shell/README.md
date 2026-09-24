# @company/shell

The host. It owns the top bar, the registry, the command palette, the widget
dashboard and the routes above an App's boundary. Everything below the header
belongs to the mounted micro-frontend — the shell adds no padding, no card and
no page title there.

## Running it

```sh
pnpm install                              # from the repo root
pnpm dev                                  # the shell, every example and the dev API
pnpm --filter @company/shell dev          # the shell alone, http://localhost:3000
pnpm --filter @company/shell build        # dist/
pnpm --filter @company/shell typecheck
pnpm --filter @company/shell lint
```

The dev server has a history-API fallback, so a deep link into a mounted App
(`/operations/wells/reduced-dls`) serves the shell document and the App routes
the rest for itself.

`tools/browser/session.mjs` opens a browser against the running servers, for
looking at a change rather than asserting on it; `pnpm verify:page` is the
assertion, and the one CI runs. Both write any screenshot to `screenshots/`,
which git ignores — nothing asserts on a picture, so a tracked one is only a
stale view of a page that has moved on since. To take one:

```
node apps/shell/scripts/screenshot.mjs /operations/wells
```

## Sign-in

The whole page is behind OIDC sign-in, and it runs before anything else: the
entry chunk either leaves for the identity provider or boots the shell. There
is no per-route authorization. It is the authorization code flow with PKCE
(`oidc-client-ts`). The session is kept in `sessionStorage`, so a reload
restores it without going back to the identity provider (renewing it through
the refresh token when it is about to expire), and it ends with the tab. A new
tab signs in for itself, which is immediate while the provider's own session
lasts, and so does a duplicated one, which drops the tokens it copied
([decisions §36](../../docs/decisions.md)).

Sign-in is configured at run time, so one build serves every environment. The
values are declared in `src/mfe.config.ts`, as a container's are, and read
through the framework's `#mfe/config` (`pluginMfeHostConfig()`), which for a
host validates without Zod ([decisions §37](../../docs/decisions.md)). The
file is `/runtime-config.json`, which `index.html` preloads alongside the entry,
and a deployment writes it from the environment when the image starts:

| Variable                    | Field               | What it does                                                                         |
| --------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| `OIDC_AUTHORITY`            | `oidcAuthority`     | the issuer URL; https, or http on localhost                                          |
| `OIDC_CLIENT_ID`            | `oidcClientId`      | the public client registered for the shell                                           |
| `OIDC_SCOPE`                | `oidcScope`         | defaults to `openid profile email offline_access`                                    |
| `OIDC_GROUPS_CLAIM`         | `oidcGroupsClaim`   | the claim read into `shellState.groups`; defaults to `groups`                        |
| `OIDC_DISABLED`             | `oidcDisabled`      | `true` runs without sign-in, as the development user                                 |
| `SHELL_LOADER`              | `loader`            | the loading screen, one of the loaders below; `drill-bit` by default                 |
| `SHELL_LOADER_MIN_DURATION` | `loaderMinDuration` | milliseconds each loader stays up at least, as JSON; `{"drill-bit":1000}` by default |

The generated `.mfe/runtime-config.sh` (`pnpm run generate`) writes the file,
in POSIX `sh` and `awk` only: copy it into an nginx image's
`/docker-entrypoint.d/` and it runs before nginx starts, writing the
environment over the declared defaults the build shipped in
`/usr/share/nginx/html`. `.mfe/.env.example` and `.mfe/runtime-config.schema.json`
say what it may carry. Serve the file with `Cache-Control: no-store`. A
deployment without the file, or with one the shell cannot read, stops on the
loading screen and says which.

In development the dev server answers `/runtime-config.json` from
`apps/shell/.mfe/runtime-config.json`, which ships with `"oidcDisabled": true`;
put an `oidcAuthority` and `oidcClientId` there instead to sign in locally.
Register `<origin>/` as both the redirect URI and the post-logout redirect URI,
and allow refresh tokens for the client (Entra ID and Okta issue them only with
`offline_access`). A production build with no provider configured refuses to
boot until either the provider or `OIDC_DISABLED=true` is set.

While sign-in and boot run, `index.html` shows a loading screen: the drawing
`SHELL_LOADER` names, with the title and status over it. It fades out as the
shell fades in; if sign-in fails the drawing stops and recedes behind the
reason and a way forward.

| Loader      | What it draws                                                               |
| ----------- | --------------------------------------------------------------------------- |
| `drill-bit` | a 3D tricone drill bit turning under a scan ring, in WebGL; drag to turn it |
| `well-log`  | a well log drilling down: gamma ray and resistivity past the bit            |
| `bounce`    | the logo bouncing on its shadow, with squash and stretch                    |

The oil-and-gas family adds 39 more, each a scene from exploration, drilling,
production and refining, or one of five mascots that follow the pointer:
`pipeline-bore`, `seismic-section`, `pdc-drill-bit`, `wellhead-pressure`,
`benzene-ring`, `reservoir-anticline`, `crude-level`, `survey-sweep`,
`manifold-flow`, `drilling-log`, `offshore-platform`, `cryogenic-sphere`,
`seabed-lidar`, `carbon-injection`, `pore-network`, `smart-pig-scan`,
`core-hologram`, `methane-plume`, `tanker-routes`, `horizontal-well`,
`form-morph`, `compressor-stage`, `crude-emulsion`, `shot-gather`,
`structure-map`, `wellhead-stack`, `saturation-voxels`, `gyro-survey`,
`gas-chromatograph`, `pumpjack-rig`, `derrick-and-bore`, `tank-farm`,
`pipe-rack`, `tri-cone-bit`, and the mascots `drip`, `flare-sprite`,
`rov-scout`, `methane-pal` and `nodding-donkey`. The five 3D scenes
(`pumpjack-rig` to `tri-cone-bit`) are drawn as wireframes.

The STRATUM family adds five procedural WebGL models, shaded like the drill bit
and turned under a scan ring with a frame and two callouts: `pumpjack-3d`,
`subsea-tree-3d`, `pipeline-3d`, `offshore-3d` (whose platform assembles from a
wireframe as it loops) and `rock-core-3d`.

Each loader is one script in `src/loaders/`, `<name>.js`, which defines the
custom element `<name>-loader`. A directory there is a family: its `kit.js`
holds what its loaders share (for the oil-and-gas scenes, the worker, the frame
loop, the helpers and the theme), and each other script in it is a loader,
`<name>.js`, that hands the kit one draw function. The build minifies every loader into
`index.html`, so none waits for a download, and the page runs only the one the
runtime configuration names, or the declared default when it cannot read it.
Each draws in a worker through an `OffscreenCanvas` where the browser has one,
so it keeps its frame rate while the page loads and boots on the main thread.

A loader is themed through CSS custom properties, which the loader's styles in
`index.html` set from Tecton's tokens for each mode. `--drill-background` is
the drill bit's backdrop (a colour, gradient, image or `transparent`), and its
other properties are listed at the top of `src/loaders/drill-bit.js`; the
STRATUM models take the same kind (`--stratum-*`, in its `kit.js`). The
oil-and-gas scenes take a background, ink and accent (`--og-*`, listed in its
`kit.js`), draw their glows normally on a light page, where adding light turns
them white, and draw above the title and status rather than behind them. Each
loader also honours a `paused` attribute, which the page sets when loading
fails.

A loader can stay on screen for a minimum time once drawn, so a fast boot does
not flash it: `loaderMinDuration` in `src/mfe.config.ts`, milliseconds per
loader, which the deployment can replace with `SHELL_LOADER_MIN_DURATION` (for
example `{"drill-bit":1500,"bounce":960}`). The drill bit and the five STRATUM
models are held for 1000 by default and the others not at all. Until then the shell waits, hidden, behind
it.

To add a loader, add `src/loaders/<name>.js` (or a scene to a family's
directory), add `'<name>'` to the `z.enum`
of `loader` and a key for it to `loaderMinDuration` in `src/mfe.config.ts`, and
map its properties onto the loader's colours in `index.html`. The build refuses
a name with no file, a file no name reaches, and a loader missing from the
durations. Every loader adds its minified size to the document, whichever
one a deployment chose: about 10 kB gzipped for the drill bit, 3 kB for the
well log, 3 kB for the bounce, 25 kB for all 39 oil-and-gas scenes and their
kit, and 16 kB for the five STRATUM models and theirs: 60 kB for the page.

## The pages the shell owns

| Route     | What it is                                     |
| --------- | ---------------------------------------------- |
| `/`       | the widget dashboard                           |
| `/<id>`   | the boundary: the App registered under that id |
| `/<id>/…` | whatever that App routes for itself            |

A definition id is lower-case letters, digits and hyphens, so `/` is the only
path the shell can claim without shadowing an App that might one day be called
that. The registry view is a sheet rather than a route for the same reason —
and because it is worth being able to open from wherever you already are.

### The surfaces in the header

Every control in the header does something, and each one is a sheet or a dialog
rather than a route, for the same reason the registry is: they are opened from
wherever you already are and dismissed back to it.

| Surface         | Opened by                  | What it is                                                                                 |
| --------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| Command palette | `⌘K` / `Ctrl+K`            | every application, every capability page, and every registered command, host or mount      |
| Developer tools | `g d` / `g r`, the palette | the override editor, and what loaded, what was rejected and the entry as published         |
| Settings        | the gear, `g s`            | theme, the dashboard canvas, and links to each App's own settings page                     |
| Help            | the question mark, `?`     | what the pieces of the page are, and every shortcut that can fire right now                |
| What's new      | the sparkle                | release notes                                                                              |
| Report a bug    | the bug                    | a report with the build, the route, the registry state and the overrides already filled in |

Below `lg` the last three move into an overflow menu rather than disappearing:
a control that is hidden at one width and absent at another is a feature nobody
can find.

They are all opened through one small store (`ui-store.ts`) rather than through
callbacks threaded down from the layout, which is what lets the palette open
settings and settings open the registry without either knowing where the other
lives.

The shell's own commands are registered through `runtime.commands.registerHost`,
so the palette renders one snapshot that holds the mounted App's as well.
`shell-commands.ts` says what each of the shell's commands is called, its
shortcut, whether it may run and what it does; `palette.tsx` says what is drawn
beside it.

Every key goes through one `keydown` listener on the document, which hands it
to `runtime.commands.handleKeyDown`. A shortcut is a field on a command, the
shell's and a mounted App's alike, so the palette shows the keys beside each
command and the help sheet lists them from the same snapshot. The shell's keys
are reserved: an App asking for one of them is refused with a diagnostic.

### The theme

The shell owns it, and `runtime.shellState` holds it: every switch — the account
menu, settings, the palette, `⌘J` — is a `shellState.apply({ theme })`, and the
chrome, a mounted App and the design system's `Toaster` all read that one value
back through the framework's `useTheme()`. One effect in `chrome.tsx` applies
it: the `dark` class on `<html>`, `colorScheme`, and `writeTheme`.

It is deliberately **not** a framework record. The legacy Angular applications
read `localStorage["theme"]` directly as the bare string `light` or `dark`, so
the shell writes exactly that key with exactly that value — the store would
write an envelope under `@host:theme`, which is neither. `preferences.ts` is the
one file that reads and writes it (`readTheme`, `writeTheme`, `preferredTheme`),
and the one raw-storage exemption that survives the host scope
(`docs/decisions.md` §24). Nothing is migrated from `company:shell:theme`.

The inline script in `index.html` reads the same bare key before first paint, so
a light-theme user never sees the document boot dark and flip. It takes only
`light` or `dark` and otherwise falls back to `prefers-color-scheme`, then dark
— the order `preferredTheme()` uses to decide the theme `createMfeRuntime` is
given, so the class on `<html>` and the shell state agree.

### Navigation an App can refuse

The shell routes its own navigations through `runtime.navigator`, so a mounted
App with unsaved work can object to one. The App does that with TanStack's own
`useBlocker` and nothing else — the framework widens that registration to cover
the navigations the App's router never sees, which is most of the ones that
lose work: the application finder, a breadcrumb, the command palette, the
browser's back button. The shell asks; the App answers in its own dialog, in
its own design system, inside its own region — the shell neither draws that
dialog nor decides what counts as unsaved. `/lab/unsaved` is the worked
example.

A reload is the one navigation nobody can negotiate, so the shell turns the
App's own `enableBeforeUnload` into the browser's prompt, which is the only
thing a page is allowed to show there.

### Navigation the shell makes

The shell's router pushes to the browser directly, and the browser reports
only `popstate`, so a navigation from the palette, the settings sheet or a
breadcrumb would change the URL under a mounted App without the App hearing of
it. `useAnnounceShellNavigation()` in `hooks.ts` calls
`runtime.navigator.announce()` after every navigation of the shell's router; the
navigator tells the mounted Apps only when the page is somewhere they were not
already told of, so a `popstate` the bridge delivered is not repeated.

### Where an App goes

`boundary.tsx` hands the region below the chrome to `AppHost`, with a `pending`
state for the load and a `fallback` with a retry for a failure. Every App is
mounted through the runtime's `mountDefinition` into an element `AppHost`
renders, in a React root of its own when React built it. The shell never asks
which framework built an App, so nothing it provides through React context
reaches a mounted App; the runtime is what they share, keyboard shortcuts
included.

### The widget dashboard

`/` composes a page out of Widgets the shell was never built against. It knows
three things about each one, all of them read from the registry: an id, an
input schema and a list of event names. Drag a Widget from the catalogue onto
the canvas — or press its Add button, which is the same thing without a pointer
— and a dialog asks for its inputs.

The form is generated over the framework's reflection of that published schema
(`describeWidgetInputs`, with `needsInputPrompt` deciding whether to ask at
all); which control each field becomes is this shell's, in
`dashboard/input-schema.ts`, and a field the build could not describe gets a raw
JSON box.

Tiles are reorderable, resizable and kept at `@host:dashboard`, `retention:
'browser'`, so a sign-out does not throw away a canvas somebody composed. The
page, settings and the palette all read it through one `useDashboardLayout()`
hook over `useStoredState`, so they bind the same record and stay in step
without a store of the shell's own. The old `company:shell:dashboard` key is not
migrated.

Everything the Widgets emit appears in the activity feed beside them, subscribed
through `DynamicWidget`'s `onEvent` since the shell knows these events only as
strings — as named fields, because a Widget's event payload is the half of its
contract a screenshot cannot show and `{"fdaId":"fda-1-02"}` is not something
anyone should have to parse by eye.

A mounting tile reserves its room with a skeleton rather than a spinner: a
container arriving used to resize its tile and move every tile below it, and a
canvas that rearranges itself under the pointer is one you cannot click.

Adding a Widget to this dashboard is a registry change, not a shell release.

## The registry

`public/registry.json` is generated by `tools/dev/build-registry.mjs` from each
container's own `.mfe/mfe-registry.json`, and fetched at boot. It is handed to
`createMfeRuntime` from `@company/mfe-react/host` raw: the runtime reads it
through every adapter the shell lists — `reactAdapter`, `angularAdapter` from
`@company/mfe-angular/registry` and `legacyAngularAdapter`, none registered
implicitly — applies developer overrides and rejects whatever fails validation. Each entry also carries the build its
container was produced from, which is what the bug report lists a line of.
`boot.tsx` supplies the runtime's diagnostics hub, built with
`telemetryDiagnosticsSink(telemetry)` so framework diagnostics reach the
telemetry provider and `installShellAuth` can report into it before the runtime
exists (`docs/decisions.md` §25).

Nobody hand-writes it. The two things the shell genuinely owns are in
`registry.source.json`: how an entry is presented in the chrome, and the
deliberately invalid fixtures below.

### Why there are two broken entries in it

`registry.source.json` carries two entries that cannot validate:
`legacy-reports` names contract major 2, and `no-manifest` has no
`manifestUrl`. They are there on purpose, because the guarantee they exercise
is one a host has to be able to rely on: **a registry is assembled from entries
produced by builds the shell does not control, so one of them being wrong is
normal.** Every entry is read independently, and a bad one costs the page that
one surface and nothing else.

Open the registry from the header (or the notice under it, or ⌘K → "Open the
registry") and the rejected tab names each one, why it was rejected, and the
entry as published. That is the whole point of the fixtures: not that
something is broken, but that you can find out what and why in one place while
everything else keeps working.

## Developer overrides

The quickest way in is the developer tools: open
`http://localhost:3000/?devtools=1`, or press `g d` if they are already on, and
the Overrides tab lists every registered definition with the URL it loaded from.
Type a dev server origin, pick the definitions that live on it, and apply — the
panel writes the key below and reloads. It also refuses a URL the boot reader
would reject, and says so before writing rather than after the reload.

The key itself is the contract, and nothing stops you setting it by hand. The
runtime reads `localStorage["company:mfe:overrides"]` **before** any remote is
registered, so an overridden App is pointed at your dev server from its very
first load:

```js
localStorage.setItem(
  'company:mfe:overrides',
  JSON.stringify({ operations: 'http://localhost:3001/mf-manifest.json' }),
)
```

Then reload — overrides are applied at boot, not per navigation. To clear:

```js
localStorage.removeItem('company:mfe:overrides')
```

An active override is reported by the developer tools: the trigger carries a
mark while one is applied, and the Overrides tab names every overridden id and
the URL it now resolves to.

The shell itself shows nothing. It used to carry a strip under the header that
said so on every page, on the grounds that a forgotten override pointing at a
dead dev server is the failure worth making impossible to miss. That strip was
removed deliberately — see `docs/decisions.md` §23 — and the cost is real: with
the tools switched off, nothing on the page says an override is applied. The
bug report still carries them, so a report written from a page with one is not
silent about it, and it names the build behind each registry entry as well —
one line each, because every surface on the page was built separately.

## Consuming @tecton/react

`@tecton/react` lives in a **separate git checkout** next to this one, is
private, and ships built output: unbundled ESM under `dist/` with a `.d.ts`
beside every module, behind an enumerated `exports` map. Three things make the
link work:

1. **`package.json`** depends on it as `"*"`, which the `@tecton/react`
   override in `pnpm-workspace.yaml` turns into a `link:` to the checkout
   (`../tecton-ui-1/packages/tecton-react` by default; that one line is the
   only place the location is written). It also declares its peers (`react-aria-components`, `cn`,
   `class-variance-authority`, `lucide-react`, `next-themes`, `sonner`,
   `react-resizable-panels`, `react-aria`) plus what its stylesheet imports
   (`tailwindcss`, `tw-animate-css`, `shadcn`, `@fontsource/*`). pnpm does not
   install a linked package's own dependencies, so each consumer has to.
2. **`tools/tecton/tecton-build.mjs`** supplies the resolution: this
   workspace's `node_modules` named by absolute path, because walking up from
   the design system's real location finds a second copy of React; and
   `NODE_PATH` for Tailwind, which resolves `@import`s from the stylesheet's
   own directory; the shell and every container import the same helper, so the
   two cannot drift. `requireTecton` fails the config when the checkout is
   missing or unbuilt, naming the location the override points at and
   `pnpm install && pnpm --filter @tecton/react build` inside that checkout.
3. **`tsconfig.json`** maps the same specifiers back at this workspace, which
   is the type-level counterpart of the above, and
   `tools/tecton/vitest.mjs` does it again for the test runner — which has no
   Module Federation to collapse the duplicates at runtime.

**Caveat.** All of that only works because the checkout sits at the relative
path the override names. A real deployment publishes `@tecton/react` as a versioned
private package, at which point the `link:` becomes an ordinary version range
and the resolution workarounds disappear. Nothing else changes.

`pnpm typecheck` runs `tools/tecton/typecheck.mjs` rather than `tsc` directly,
for the cross-platform way it spawns `tsc` and for the one sentence it prints
when the design-system checkout is missing or unbuilt, in place of a page of
"cannot find module" errors.

Tecton's palette replaces Tailwind's: stock colour utilities (`bg-red-500`,
`text-zinc-400`) generate **no CSS at all**. The preset that would catch this,
`@tecton/eslint-config`, has been removed from the design system, so nothing
reports a stock colour class — it simply produces no rule, so the element
renders unstyled and the only place to catch it is the browser.

## The page's stylesheet

`src/styles/app.css` is the shell's stylesheet and scans the shell's own
sources only. It imports the design system's `globals.css`, which carries the
theme, the preflight, the font faces and Tailwind's `@property` registrations —
the document-level half, this stylesheet's alone, which inherits into every
mounted container, so a tenant customisation or a mode flip made here reaches
all of them with nothing wired up. Each container compiles and scopes its own
stylesheet for the classes it renders; `docs/decisions.md` §17 has the
mechanism and its two limits.

## Federation

The shell is the federation **host**: it consumes remotes and is not itself a
container, so it does not use `pluginMfe()` from `@company/mfe-rspack`. It
declares no static remotes — each is registered at runtime by the runtime's
`createFederationContainerLoader`, which is handed `registerRemotes` and
`loadRemote` in `src/boot.tsx`, the one file that knows federation exists,
which the root lint config exempts from the import boundary by name.

The share scope is the one part of this build every container also has, so
`rsbuild.config.ts` asks the build package for it (`docs/decisions.md` §27),
together with the strategy shares in it are resolved by (§30):

```ts
...hostFederation({ root: here }) // @company/mfe-rspack/federation
```

That strategy is `loaded-first`. Under Module Federation's default the host
would re-fetch every registered remote's manifest before resolving any share,
so a single unreachable manifest brought down whatever the shell had not
loaded yet — the chrome included.

Every React-bound candidate goes in the share scope named after the React this
shell installed, `react@19.3.0`, as a strict singleton: `react`, `react-dom`,
`sonner`, `@company/mfe-react`, `@tanstack/react-router` and
`@tanstack/react-query`, each holding module state a second copy would
duplicate. The design system's own entries from `@tecton/react/federation/shared`
join that scope with the design system's flags: `@tecton/react/` — a prefix
share, since the package has no root export, with an explicit `version` because
Module Federation cannot infer one for a prefix — and `react-aria-components`,
without `singleton`. `recharts` is on that list too, but the shell does not
install it, and the host shares only what its own `node_modules` hold.
`@company/mfe-core` and `@company/mfe-runtime` are page singletons in
`default`, read beside `@company/mfe-react` because this shell declares neither:
it imports only its adapters.

The loader registers each container with the scopes its registry entry lists
(`shareScopes`), `default` first. A container on this shell's React version
takes the shell's copies; one on another React version keeps its own, so its
toasts go to its own `sonner` and never reach this shell's `Toaster`
(`docs/decisions.md` §33).

## Hot updates

Editing a component in `src/shell/` updates that component in place. That is
not free: React Refresh replaces a module only when it can prove every export
is a component, so the hooks live in `shell/hooks.ts`, the boot facts in
`shell/workspace.ts`, and `shell/router.tsx` holds no component. A single
exported hook beside a component turns every edit to that file into a full page
reload, and the symptom — the page reloads, state is lost — looks like a
bundler problem rather than a module-shape one.

`dev.lazyCompilation` is off for the same reason: it wraps the entry in a proxy
module that is not a refresh boundary, so every update propagated through it to
the entry and came back as a reload.
