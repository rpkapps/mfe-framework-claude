# The diagrams

Ten Excalidraw scenes, and the SVGs the docs use. Both are committed, and they are committed
together: an SVG whose scene has moved on is a picture of software that no longer exists, so
`pnpm diagrams:check` fails the build when the two disagree.

```
tools/diagrams/scenes/<name>.excalidraw   the scene — the source of truth
docs/diagrams/<name>.svg                  the rendered figure, with the scene embedded in it
```

## Editing a diagram

1. Open `tools/diagrams/scenes/<name>.excalidraw` on <https://excalidraw.com> (**Open** in the
   menu, or drag the file onto the canvas). `docs/diagrams/<name>.svg` opens there too: the
   scene travels inside the SVG, so the committed figure is also the editable source.
2. Change it. Keep to the conventions below — the ten are meant to read as one set.
3. **Save back to `tools/diagrams/scenes/<name>.excalidraw`**, over the file you opened. Use
   **Save to disk** (or **Export image → Excalidraw** with _Embed scene_); saving to a new name
   leaves the old scene in place and the render will keep using it.
4. Run `pnpm diagrams:render`.
5. Commit the `.excalidraw` and the `.svg` together.

`pnpm diagrams:render --only <name>` rewrites one figure while you iterate.

The `.excalidraw` files were first drafted by `tools/diagrams/draft/build-scenes.mjs`, which is
why ten scenes share one grid, one palette and one text size. **The `.excalidraw` files are the
source of truth from here on.** The draft script is kept only to show how they were laid out,
and running it overwrites every scene, so do not run it to change one diagram.

## How the render works

`tools/diagrams/render.mjs` is plain Node. For every scene it produces
`docs/diagrams/<name>.svg` with:

| Setting              | Value   | Why                                                        |
| -------------------- | ------- | ---------------------------------------------------------- |
| `exportEmbedScene`   | `true`  | the SVG can be dropped back onto excalidraw.com and edited |
| `exportBackground`   | `false` | transparent, so the figure sits on the page's background   |
| `exportWithDarkMode` | `false` | light colours; the docs site darkens them with CSS         |
| `exportPadding`      | `16`    | the same margin on every figure                            |

`exportToSvg` comes from `@excalidraw/excalidraw`, which is a React component library: it needs
a DOM to measure text in and a canvas to trace rough shapes on, so the export runs in headless
Chromium through Playwright rather than in Node. Three things follow.

- **The library is bundled first.** The published package is one ES module that imports React,
  roughjs, jotai and a dozen other bare specifiers, which no browser resolves on its own. The
  script bundles `tools/diagrams/browser/export-entry.js` with Rspack (through `@rsbuild/core`,
  already a dev dependency) into `node_modules/.cache/diagrams/<key>/`, keyed on the entry and
  the installed version, so the bundle is built once and reused. It takes about a second.
- **Nothing is fetched.** A local HTTP server on `127.0.0.1` serves the bundle and the font
  files out of the installed package, and `window.EXCALIDRAW_ASSET_PATH` points at it, so the
  fonts never reach Excalidraw's CDN fallback. The page is watched: a request to anything but
  that server fails the render. The whole thing works with the network unplugged.
- **Chromium has to be installed.** `pnpm install` does not download one. Run
  `pnpm exec playwright install chromium` once, or point `PLAYWRIGHT_BROWSERS_PATH` at an
  install that already has one — the same browser `pnpm verify:page` uses. Without it the
  script stops and says so.

The output is deterministic: the same scene renders byte-identical every time. Excalidraw would
otherwise write `window.location.origin` — this run's ephemeral port — into the embedded scene,
so the script sets `window.EXCALIDRAW_EXPORT_SOURCE` to a fixed string instead.

Excalidraw subsets each font and embeds it in the SVG as a `data:` URI, so a committed figure
carries Excalifont and Comic Shanns with it and renders in the hand-drawn face offline.

One message on the console is not a failure and is filtered: Excalidraw subsets fonts in a
module worker and reports falling back to the main thread as an error. A bundled copy can never
have that worker — the worker module's own `import.meta.url` is what it uses as the worker URL,
and a bundler rewrites it. The fallback produces the same subsets.

## The check

```sh
pnpm diagrams:check
```

re-renders every scene into a temporary directory and compares it with what is committed. It
names each figure that differs, and how far into the file the first difference is:

```
1 committed diagram no longer matches the scene beside tools/diagrams/scenes/:

  - docs/diagrams/lifecycle.svg differs from its scene: committed 58 214 bytes, rendered 58 402 bytes, first difference at byte 1832

Run `pnpm diagrams:render` and commit the scene and the SVG together.
```

It is a separate step, not part of `pnpm check`. It takes about three seconds and needs no
network, but it does need the Chromium above, and `pnpm check` is browser-free — as
`pnpm verify:page` is, and for the same reason. Run `pnpm exec playwright install chromium` once,
or point `PLAYWRIGHT_BROWSERS_PATH` at an install that has one, and then `pnpm diagrams:check`
beside the other checks. Without a browser it stops and the message names that command.

## Visual conventions

The ten are one set. A diagram that invents its own colours makes the reader learn them twice.

- **Hand-drawn.** `roughness: 1`, stroke `#1e1e1e`. Labels in Excalifont (`fontFamily: 5`);
  anything that is spelled exactly as it is on disk — a file name, a module specifier, a call,
  an error code — in Comic Shanns (`fontFamily: 8`). Those are the two faces the package
  embeds, so they are the two that survive in the SVG.
- **One hue per concern, in all ten**, from Excalidraw's own palette:

  | Colour           | Means                                        |
  | ---------------- | -------------------------------------------- |
  | yellow `#ffec99` | the shell — the host page                    |
  | blue `#a5d8ff`   | a container: one App, or a bundle of Widgets |
  | violet `#d0bfff` | something the build generated                |
  | green `#b2f2bb`  | storage                                      |
  | orange `#ffd8a8` | the network and the API                      |
  | grey `#f1f3f5`   | the browser document, and neutral panels     |
  | red `#ffc9c9`    | a failure path                               |
  | transparent      | a framework package                          |

  A diagram in which the colours carry meaning draws a small legend. One that uses a single
  colour throughout does not.

- **Size.** Around 1200 x 700 to 1450 x 900. The diagram's own name is a 28 px text element at
  the top left, with a one-line subtitle under it in grey at 16 px. Body text is 11.5–13 px and
  headings 15–17 px.
- **Transparent background.** No page-coloured rectangle behind anything.
- **Arrows.** Bound at both ends, so moving a box takes its arrows with it. A bent arrow has
  sharp corners: Excalidraw's proportional rounding is a fraction of the segment length, so a
  long elbow rounds itself into a loop. Arrows are labelled where the order or the meaning is
  not obvious from the shapes; a numbered sequence carries its numbers in circles instead.
- Nothing decorative. Every box on a diagram is something a reader can look up in the code.

## What each diagram draws

The paragraphs below describe each figure in reading order. They are what the docs' text
equivalents are written from, so **a change to a scene is a change to its paragraph**.

| Diagram                | Where it is used                                         |
| ---------------------- | -------------------------------------------------------- |
| `system-at-rest`       | the design map: the deployed topology                    |
| `boot-to-mount`        | the design map: page load to a rendered App              |
| `layers`               | the design map: the packages and the import DAG          |
| `isolation-boundaries` | the design map: what separates a container from the page |
| `app-vs-widget`        | guide 1, the shape: App or Widget                        |
| `config-and-data`      | guide 3, configuration and data                          |
| `lifecycle`            | guide 6, lifecycle                                       |
| `storage-retention`    | guide 7, storage                                         |
| `styling-scope`        | guide 8, styling                                         |
| `dev-workflow`         | guide 9, the daily workflow                              |

### system-at-rest

Subtitle: "What is deployed where, before anyone opens the page. Nothing is running yet." On
the left, a yellow panel headed **The shell origin** ("the host; dev: http://localhost:3000")
holds three stacked boxes — `index.html`, `the shell bundle`, and a violet `registry.json` —
with the grey note "one record per definition: id, container, manifestUrl" below them. In the
middle, three blue panels stacked top to bottom: **operations — an App** ("its own origin; dev:
http://localhost:3001"), **alert-panel — one Widget** (:3003) and **insights — four Widgets**
(:3004). Each of the three holds the same four violet boxes in a two-by-two grid:
`mf-manifest.json`, `remoteEntry.js`, `styles.css`, `runtime-config.json`. On the right, an
orange panel **The API** ("dev: http://localhost:3010") holding one box, `GET /api/assets`.
Bottom left, a dashed grey panel **The browser page** reading "One document, served from the
shell origin. Every container above is fetched into this one page: its chunks, its stylesheet
and its configuration." Three grey dotted arrows run from `registry.json` to each container
panel; the top one is labelled **manifestUrl**. A black dashed arrow runs from the browser page
up to the shell origin, labelled "served from". A blue dotted arrow runs from the `operations`
panel's `runtime-config.json` to the API panel, with blue text beside it: "runtime-config.json
names the API. #mfe/fetch resolves a request against it and attaches the session token to the
origins declared { api: true }, and to no others." A legend at the bottom right names the five
colours used.

### boot-to-mount

Subtitle: "Page load to a rendered App, in the order the code runs, with the branches that
fail." Two columns of numbered steps, each step a box holding a grey numbered circle, a
sentence, the call in mono and a grey remark; a short arrow joins each step to the next.
The left column is headed "In the shell — apps/shell/src/boot.tsx": **1** the document boots
(`src/boot.tsx`; index.html has already set the theme, before first paint); **2** the
diagnostics hub is built first (`new DiagnosticsHub([telemetryDiagnosticsSink(t)])`; the
runtime adopts this hub rather than making one); **3** the shell installs the page's one
session (`installShellAuth({ tokens, diagnostics })`; before any remote is registered); **4**
the registry is fetched (`await fetch('/registry.json')`; a registry that fails to load is a
diagnostic, not a crash); **5** the runtime is assembled (`createMfeRuntime({ registryEntries,
loader })`; developer overrides are read before anything registers); **6** every entry is
normalized on its own (`normalizeRegistry: accepted, or quarantined`; one malformed entry loses
only itself). An arrow runs from step 6 up the gutter into the top of the right column, headed
"In the framework — @company/mfe-react": **7** the URL picks the boundary
(`/operations/wells matches the shell route /$appId`); **8** the boundary hands the page over
(`<AppHost appId='operations' basePath='/operations'>`; below this the shell renders nothing of
its own); **9** the container is loaded, once (`registerRemotes, then
loadRemote('operations/app')`; one load per container, shared by every waiter); **10** the
mount is made by the effect that ends it (`useOwnedMount(() => createMount({ ... }))`; token,
overlay root, telemetry, Query client, storage); **11** the factory runs once, and is checked
(`createRouter({ basepath: basePath, history })`; basepath through unchanged, the supplied
history itself); **12** the App is on the page (`MfeScopeRoot, StyleRoot, RouterProvider`). On
the right, two dashed panels: **When step 9 fails**, holding the red boxes
`load/manifest-failure`, `load/entry-failure` and `registry/invalid-descriptor`; and **When
step 11 fails**, holding `app/invalid-base-path` and `app/invalid-router`. A red dashed arrow
runs from step 9 to the first panel and from step 11 to the second. Two red arrows run from the
two panels down into a grey panel **What the page shows**: "'operations could not be loaded',
the message the error carries, its code, and a Retry button that makes a genuinely fresh
attempt. The chrome stays. Every other App stays reachable. One boundary is the whole cost of
the failure."

### layers

Subtitle: "The packages, which way the imports point, and which of them an author ever sees."
Two dashed regions. The left one, **In the browser** ("an arrow points at what a package
depends on"), holds the dependency graph: `apps/shell` (yellow) and `examples/operations`
(blue) on the top row, `@company/mfe-react` and `@company/mfe-legacy-angular` below them,
`@company/mfe-host` under those two, and `@company/mfe-core` at the bottom. Arrows run
shell → mfe-react, operations → mfe-react, mfe-react → mfe-host, mfe-legacy-angular → mfe-host
and mfe-host → mfe-core. Under the graph: "pnpm boundaries reads the imports and the manifests,
so no arrow can be reversed by editing a package.json. Neither mfe-core nor mfe-host may import
React, a router or Module Federation." The right region, **At build time** ("one entry in the
container's rsbuild.config.ts"), has a violet box `@company/mfe-rspack pluginMfe()` on the left
— captioned "discovery, the generated modules, the federation options and the container's own
scoped stylesheet" — and a column of seven violet boxes on the right: `#mfe/config`,
`#mfe/fetch`, `#mfe/meta`, `.mfe/entries/container.ts`, `.mfe/entries/app.ts`,
`.mfe/mfe-registry.json` and `.mfe/styles.css`. One arrow between them, labelled "generates". A
third dashed region, **Beside the DAG**, holds three plain boxes: `@company/create-mfe`
(captioned `pnpm create @company/mfe <dir>`), `@company/eslint-plugin-mfe` ("the author and
framework presets") and `@company/mfe-devtools` ("in every build, gated on one key"). A small
green dot marks each thing an author writes or imports: `examples/operations`,
`@company/mfe-react`, `#mfe/config` and `#mfe/fetch`. The legend names the four colours and the
dot.

### isolation-boundaries

Subtitle: "Six boundaries between one mounted container and the rest of the page." A blue panel
sits in the middle — **One mount of the operations App**, "its mount token, its basePath, its
own scope root", with the line "Everything around it is a seam the framework owns." Six grey
panels surround it, three above and three below, each joined to the centre by a grey dashed
arrow pointing outwards. **URL**: basePath is assigned by the host and passed straight through
to `createRouter({ basepath })`; the history is built over the navigation bridge by
`createBoundaryHistory`, never by `createBrowserHistory`, which reassigns
`window.history.pushState` for everyone. **Styles**: the container ships only the utilities for
its own classes, wrapped by the build in `@scope ([data-mfe-scope="operations"]) to
([data-mfe-scope])`; the shell keeps the document half — preflight, the fonts, `@property`, the
theme variables. **Storage**: every record goes through the storage boundary under the key
`<definitionId>:<name>`; `retention: 'user'` is the default and is wiped when the identity or
the group set changes; state the page owns rather than any definition goes in the reserved
`@host` scope. **Network**: the generated `#mfe/fetch` resolves a relative request against the
base URL that `runtime-config.json` supplied and attaches the shell's session token to the
origins declared `{ api: true }` — an exact scheme, host and port set, with no wildcards and no
substrings. **Errors**: every failure is an `MfeError` carrying a code from a closed union, the
definition id, the operation and the repair; it reaches the shell's `DiagnosticsHub`, which
forwards it to telemetry, and a failed mount costs its own boundary and nothing else. **Shared
singletons**: `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query` and
`@company/mfe-*` resolve once per page through the Module Federation share scope, and the host
declares `shareStrategy: 'loaded-first'` so one unreachable manifest cannot take the whole page
down with it.

### app-vs-widget

Subtitle: "Apps take URLs. Widgets take props. The URL is the whole test." A diamond at the top
asks "Can this surface be addressed by a URL?". Two arrows leave it, labelled **yes** and
**no**, into two blue panels. The left panel, **Yes — it is an App** ("routable, independently
deployable, one URL boundary each"), holds four boxes joined by downward arrows, each with a
line of explanation under it: `https://shell.example/operations/wells/reduced-dls` ("the shell
owns /operations; the App owns everything after it"); `createApp({ id: 'operations', version,
router })` ("one call in src/mfe.ts; router is a factory, called once per mount"); "the App's
own TanStack route tree" ("basepath makes every route, Link and navigate relative to the
boundary"); and `mfeRoute({ appId: 'reports' }) at /reports/$` ("An App delegates a nested App
at a splat route. boundaryAboveSplat strips the remainder, so reports is mounted at
/operations/reports and never learns whether it was reached on its own or inside another App").
The right panel, **No — it is a Widget** ("non-routable, mounted by whoever renders it, many
per page"), holds four boxes the same way: `createWidget({ id: 'alert-panel', inputs, events,
render })` ("inputs and events are Zod schemas; the build reads them statically");
`lazyWidget('alert-panel', { contract: alertPanelContract })` ("called at module scope: the
component's identity is what React uses to decide it is looking at the same element. One built
during render remounts the Widget"); `<AlertPanel alertId={id} onAcknowledged={ack} />`
("inputs arrive as props; events arrive as onX props, typed from the contract"); and
`<DynamicWidget widgetId={tile.widgetId} {...tile.inputs} />` ("for a host that learns which
Widgets exist only when it reads the registry. No contract, so no consumer-side types, and
every event arrives through onEvent(name, payload). The provider still validates every input it
is given").

### config-and-data

Subtitle: "From one file per deployment to one authenticated request." Six panels. Top left,
blue, **What the author declares** ("src/mfe.config.ts — declarations only") showing
`export default { apiBaseUrl: env('API_BASE_URL', z.string().url(), { api: true }),
telemetryEnabled: env('TELEMETRY_ENABLED', z.coerce.boolean().default(true)) }`. Below it,
orange, **What the deployment writes** ("runtime-config.json, beside the assets") showing
`{ "apiBaseUrl": "http://localhost:3010/api/", "telemetryEnabled": false }` and the note "values
only: no envelope, and no secret". In the middle, violet, **#mfe/config** ("generated; the type
comes from the schemas"): "Fetched once, awaited at the top level of the module, so nothing that
imports it runs before it has validated. An immutable snapshot: changing a value takes a new
deployment and a page reload, and nothing polls. An undeclared key fails rather than being
ignored, because it is usually a misspelled one." An arrow from the declaration panel is
labelled "the build reads the schemas" and an arrow from the deployment panel "fetched at load".
Under `#mfe/config`, a dashed panel **When it cannot start** with three red boxes:
`config/missing: 404`, `config/unreachable: no answer`, `config/invalid: a rejected field`,
reached by a red dashed arrow. To the right, violet, **#mfe/fetch** ("generated; standard fetch,
never a patch") showing `const transport = createContainerTransport({ id: 'operations',
apiBaseUrl: config.apiBaseUrl, apiOrigins })` and `export const { fetch, getAccessToken } =
transport`, reached by an arrow from `#mfe/config`. Below it, yellow, **The shell's one session**
("installShellAuth({ tokens }), at boot"): "One session serves the whole page, so a refresh is
single-flight across every mount. A second concurrent refresh would present a credential the
server has already retired, and sign the user out." An arrow runs up from it into `#mfe/fetch`,
labelled "the token". A blue arrow leaves `#mfe/fetch` on the right, runs down the edge of the
figure labelled "one request", and arrives at the orange **The API** panel
("http://localhost:3010/api/ in dev"): "The token goes only to an origin declared { api: true }.
Any other origin is called without it, and auth/undeclared-origin says so." A legend names the
five colours.

### lifecycle

Subtitle: "What a mount does between the first render and the last, and where each failure
goes." Five panels in a row, joined left to right by arrows. **the load suspends**
(`loadDefinition(runtime, id)`): React Suspense shows the pending slot while the container is
fetched — the shell's "Loading operations", or the pending prop a Widget's consumer passed; one
load per container per runtime, shared by every waiter and cached, a rejection included; there
is no time budget, the load suspends until it settles. **the definition is checked**
(`isMfeDefinition, then the router`): what the container exposed has to be a definition made by
`createApp` or `createWidget`, of the kind the registry advertised, and for an App the router
the author's factory returned is checked too — the basePath passed through unchanged, the
supplied history itself, and the supplied context. **the mount is created** (`createMount(...)`):
an effect creates it and the same effect's cleanup destroys it, so one render passes with no
mount; it holds a mount token, the scope root and the style root, an overlay root in the
document, a tracer, a Query client, the definition's two storage areas, and the `AbortSignal`
`useMfeSignal` hands the author. **rendered, taking input** (`AppMount / WidgetMount`, the one
blue panel): the App routes inside its own boundary, a Widget validates every committed input
change and every event it emits, and a rejected input keeps the last one that passed and reports
a diagnostic rather than blanking a Widget already on the page. A loop arrow leaves the top of
this panel and returns to it, labelled "inputs updated, or an event emitted". **disposed**
(`dispose()`): registrations go first, so a disposed mount cannot appear in the palette
mid-teardown — commands, then the navigator; then the signal aborts, queries are cancelled and
cleared, telemetry ends, and the overlay root is removed from the document. Below, a dashed
panel **Where a failure goes** holds six red boxes in a row — `load/manifest-failure`,
`load/entry-failure`, `app/invalid-base-path`, `app/invalid-router`, `contract/input-mismatch`,
`contract/event-mismatch` — reached by red dashed arrows dropping from the first, second and
fourth panels, and reads: "The first four are thrown, caught by the RetryBoundary and handed to
the fallback slot as { error, retry }: the shell draws 'operations could not be loaded' with the
message, the code and a Retry button, and retry() forgets the cached load so the next attempt is
a genuinely fresh one. A Widget's first bad input throws the same way; a later one is reported as
a diagnostic and the last inputs that passed stay on the page. A render error inside a mounted
App reaches that App's own defaultErrorComponent, inside its own boundary, and the host never
sees it." A grey panel at the bottom, **StrictMode mounts everything twice**, reads: "In
development React mounts, unmounts and mounts again without re-rendering: create, dispose,
create. That is why the mount is built by the effect that destroys it. A mount built in useMemo
is not re-evaluated on the second setup, so the second setup ran against the object the first
cleanup had already disposed — a CancelledError in development, while production worked." There
is no deadline anywhere on the figure, because there is none on this path.

### storage-retention

Subtitle: "How a stored key is composed, and who can read it back afterwards." Three panels
across the top, joined by arrows. Blue, **What the author writes** ("inside a mount, so the
scope is the definition"): `const [filters, setFilters] = useStoredState('filters', schema,
{ defaultValue: { status: 'open' } })`. Green, **What it binds to** ("the defaults are the safe
answers"): `storage: 'local'`, `retention: 'user'`, `version: 1`. Green, **What is actually
stored** ("one key, one envelope"): key `operations:filters`, value `{ "v": 1, "r": "user",
"g": "<session generation>", "d": { "status": "open" } }`. Under the three: "The key is
`<definitionId>:<name>`, never scoped by mount token, so two mounts of one definition read one
record. The `g` field fences a user-retained record to one session generation: a record written under
another generation reads as absent." Below that, a panel **What survives what** ("storage decides
how long the browser keeps it; retention decides who may read it back") holds a table with two
columns, `retention: 'user' (default)` and `retention: 'browser'`, and five rows: the identity
changes (login, logout, account, tenant) — wiped / kept, and the next person here reads it; the
group set changes — wiped / kept; a reload — kept / kept; the tab closes, with
`storage: 'session'` — gone with the tab / gone with the tab; the build raises version —
`migrate()`, or unreadable / `migrate()`, or unreadable. To the right, a yellow panel **The
page's own state** ("bindHost() and hostStorage()"): "Outside a mount, useStoredState resolves
to the reserved @host scope. No definition can claim that name: @ is not a legal character in a
definition id." Under it a red panel **The one thing to get right** ("retention: 'browser' opts
out of the wipe"): "Nothing clears it, which also means every user of this browser profile reads
the same value. It is for a display density or a collapsed panel, never for anything derived
from a user's data." A legend names the four colours.

### styling-scope

Subtitle: "One stylesheet in two halves: the document is the shell's, the utilities are the
container's." Three panels across the top. Yellow, **The shell owns the document half**
("apps/shell/src/styles/app.css"), listing preflight — the reset, the fonts and
`--font-sans` / `--font-mono`, `@property` registrations, the theme variables on `:root`, and
"All of it inherits into every container, so no container ships a reset or a variable of its
own." Violet, **The container ships its own utilities** (".mfe/styles.css, generated") showing
`@layer theme, base, components, utilities;`, `@import "tailwindcss/theme.css" layer(theme);`,
`@import "tailwindcss/utilities.css" layer(utilities);` and
`@import "@tecton/react/styles/scoped.css";`, with "Deliberately not `@import "tailwindcss"`,
which would bring preflight with it. Tailwind emits a utility only for a class it has seen, so
this is the CSS for this container and nothing else." An arrow leads to the third, violet,
**What the build wraps it in** ("the design system's plugin, after Tailwind") showing
`@scope ([data-mfe-scope="operations"]) to ([data-mfe-scope]) { /* every rule this container
emitted */ }`, with "The lower boundary is the next mount root below, so a nested container's
CSS is never this one's. `:root` and `:host` are rewritten onto the scope root, and `@keyframes`
are renamed after this container." Below, a wide grey panel **What the page looks like while the
App is mounted** shows the markup: `<body>`, the shell chrome, then
`<div data-mfe-scope="operations" data-mfe-kind="app" data-mfe-mount="operations#1"
style="display: contents">` marked "the scope root", `<StyleRoot>` marked "the container's own
ThemeRoot" with the App inside it, and a second `<div data-mfe-scope="operations"
data-mfe-mount="operations#1" data-mfe-overlay-root data-tecton-root>` marked "the overlay root"
holding every dialog, popover, tooltip and menu. Under the markup: "The scope root is
`display: contents`, so it anchors a selector without becoming a box in the layout. The overlay
root sits at body level and carries the same attribute, which is what keeps an overlay inside
the container's scope instead of on a bare document body." A grey dashed arrow from the shell
panel to this one is labelled "inherits into every container", and an arrow from the scope panel
is labelled "loaded with the container". A red panel to the right, **The stated limit**
("docs/decisions.md, 5 and 17"), reads: "@scope is the narrowest-supported feature the framework
requires, and it is emitted with no fallback. Below Chrome 118, Firefox 146 or iOS Safari 17.4
the rule does not apply, and the last stylesheet on the page wins, unscoped. Each container's
@keyframes names carry its ids as a suffix, because such names are page-wide whatever scopes the
rules."

### dev-workflow

Subtitle: "What pnpm dev starts, how the shell is pointed at it, and what one edit costs." On
the left, a yellow box `pnpm dev` with the note "tools/dev/dev.mjs. It checks that 3000-3005 are
free before it starts anything (3010 is not checked): a container's port is part of its address,
so it cannot be moved without the shell losing it", and under it a violet box `registry.json`
with "written by pnpm run generate, which pnpm dev runs itself. The shell learns that a container
exists only from this file." An arrow from `pnpm dev` and a grey dotted arrow from
`registry.json` point into the middle column, headed "one dev server each": seven boxes, one per
process — `apps/shell :3000` (yellow), `examples/operations :3001`, `examples/reports :3002`,
`examples/alert-panel :3003`, `examples/insights :3004`, `examples/lab :3005` (all blue) and
`tools/dev/api.mjs :3010` (orange) — with the note "Each container's port comes from its own
package.json 'mfe' block, so adding an example is a one-file change in it", and a legend below.
On the right, a green panel **Pointing the shell at a local container** ("pnpm dev prints this
with the real ids and URLs") shows the console snippet: `const key = 'company:mfe:overrides'`,
reading the key out of `localStorage`, `overrides['operations'] =
'http://localhost:3001/mf-manifest.json'`, writing it back, `location.reload()`; under it "The
reload is not optional: the old container is already registered under the same name, and
disposing a mount does not reach it." Below, a grey panel **Why one edit hot-updates and another
reloads** ("React Refresh replaces a module only when every export is a component") holds a red
box `src/mfe.ts — a definition and a contract` ("never a refresh boundary, so an edit reloads the
whole page") and a green box `src/alert-panel.tsx — only the component` ("hot-updates in place,
keeping the state the component held"), and ends with "pnpm hmr:probe <file> [url] says which of
the two happened: the change appears either way, and only what was lost is different."
