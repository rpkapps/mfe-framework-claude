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
| Command palette | `⌘K` / `Ctrl+K`            | every application, every capability page, the shell's own commands, the mounted App's      |
| Developer tools | `g d` / `g r`, the palette | the override editor, and what loaded, what was rejected and the descriptor as published    |
| Settings        | the gear, `g s`            | theme, the dashboard canvas, and links to each App's own settings page                     |
| Help            | the question mark, `?`     | what the pieces of the page are, and the live shortcut registry                            |
| What's new      | the sparkle                | release notes                                                                              |
| Report a bug    | the bug                    | a report with the build, the route, the registry state and the overrides already filled in |

Below `lg` the last three move into an overflow menu rather than disappearing:
a control that is hidden at one width and absent at another is a feature nobody
can find.

They are all opened through one small store (`ui-store.ts`) rather than through
callbacks threaded down from the layout, which is what lets the palette open
settings and settings open the registry without either knowing where the other
lives.

### The theme

The shell owns it: one document class, one value published to every mount
through the shell state. It is remembered in `localStorage` under the shell's
own key — not through the framework's storage, which is scoped to a definition
and retired on a session change, and the theme belongs to none of the
definitions on the page and should survive a sign-out. An inline script in
`index.html` applies the same choice before first paint, so a light-theme user
never sees the document boot dark and flip.

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

### The widget dashboard

`/` composes a page out of Widgets the shell was never built against. It knows
three things about each one, all of them read from the registry: an id, an
input schema and a list of event names. Drag a Widget from the catalogue onto
the canvas — or press its Add button, which is the same thing without a pointer
— and a dialog asks for its inputs, with every control generated from the
schema that Widget's own build published. Tiles are reorderable, resizable and
saved in `localStorage`, and everything the Widgets emit appears in the activity
feed beside them — as named fields, because a Widget's event payload is the half
of its contract a screenshot cannot show and `{"fdaId":"fda-1-02"}` is not
something anyone should have to parse by eye.

A mounting tile reserves its room with a skeleton rather than a spinner: a
container arriving used to resize its tile and move every tile below it, and a
canvas that rearranges itself under the pointer is one you cannot click.

Adding a Widget to this dashboard is a registry change, not a shell release.

## The registry

`public/registry.json` is generated by `tools/dev/build-registry.mjs` from each
container's own `.mfe/mfe-registry.json`, and fetched at boot. It is handed to
`createMfeRuntime` raw: the runtime normalizes it, applies developer overrides
and quarantines whatever fails validation.

Nobody hand-writes it. The two things the shell genuinely owns are in
`registry.source.json`: how an entry is presented in the chrome, and the
deliberately invalid fixtures below.

### Why there are two broken entries in it

`registry.source.json` carries two descriptors that cannot validate:
`legacy-reports` advertises contract major 2, and `no-manifest` has no
`manifestUrl`. They are there on purpose, because the guarantee they exercise
is one a host has to be able to rely on: **a registry is assembled from
descriptors produced by builds the shell does not control, so one of them being
wrong is normal.** Every entry is validated independently, and a bad one costs
the page that one surface and nothing else.

Open the registry from the header (or the notice under it, or ⌘K → "Open the
registry") and the rejected tab names each one, why it was rejected, and the
descriptor as published. That is the whole point of the fixtures: not that
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
silent about it.

## Consuming @tecton/react

`@tecton/react` lives in a **separate git checkout** next to this one, is
private, and ships built output: unbundled ESM under `dist/` with a `.d.ts`
beside every module, behind an enumerated `exports` map. Three things make the
link work:

1. **`package.json`** depends on it as `link:../../../tecton-ui-1/packages/tecton-react`,
   and declares its peers (`react-aria-components`, `cn`,
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
   missing or unbuilt, naming
   `pnpm install && pnpm --filter @tecton/react build` inside `tecton-ui-1`.
3. **`tsconfig.json`** maps the same specifiers back at this workspace, which
   is the type-level counterpart of the above, and
   `tools/tecton/vitest.mjs` does it again for the test runner — which has no
   Module Federation to collapse the duplicates at runtime.

**Caveat.** All of that only works because the checkout sits at a known
relative path. A real deployment publishes `@tecton/react` as a versioned
private package, at which point the `link:` becomes an ordinary version range
and the resolution workarounds disappear. Nothing else changes.

`pnpm typecheck` runs `tools/tecton/typecheck.mjs` rather than `tsc` directly,
for the cross-platform way it spawns `tsc` and for the one sentence it prints
when the design-system checkout is missing or unbuilt, in place of a page of
"cannot find module" errors.

Tecton's palette replaces Tailwind's: stock colour utilities (`bg-red-500`,
`text-zinc-400`) generate **no CSS at all**. `@tecton/eslint-config` is wired
into the workspace lint so that is an error naming the nearest Tecton token,
rather than something you discover by looking at the page.

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
declares no static remotes — each is registered at runtime by the framework's
loader, which is handed `registerRemotes` and `loadRemote` in `src/boot.tsx`,
the one file that knows federation exists. `react`, `react-dom`, `sonner`,
`@company/mfe-core`, `@company/mfe-host`, `@company/mfe-react`,
`@tanstack/react-router` and `@tanstack/react-query` are shared as strict
singletons, each holding module state a second copy would duplicate, so a
remote that resolves its own is an error; `@tecton/react/` — a prefix share,
since the package has no root export, with an explicit `version` because
Module Federation cannot infer one for a prefix — and
`react-aria-components` are shared without `singleton`, so a container may run
its own version. The design system's half of that list comes from
`@tecton/react/federation/shared`, which the build plugin
(`packages/mfe-rspack/src/federation/sharing.ts`) reads too; the versions come
from this install.

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
