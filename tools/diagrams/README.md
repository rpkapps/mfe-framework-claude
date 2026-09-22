# The diagrams

Eleven Excalidraw scenes, and the SVGs the docs use. Both are committed, and they are committed
together: an SVG whose scene has moved on is a picture of software that no longer exists, so
`pnpm diagrams:check` fails the build when the two disagree.

```
tools/diagrams/scenes/<name>.excalidraw   the scene — the source of truth
docs/diagrams/<name>.svg                  the rendered figure, with the scene embedded in it
```

## The text budget

A diagram shows structure and flow. The explanation belongs in the page beside it, and the
paragraph for each figure further down is what that page is written from. So:

- **A box holds a name of at most four words, and at most one subtitle of at most eight.** No
  sentences, no body text, no parenthetical notes inside a box. A code identifier is one word:
  `createApp({ id: 'operations', router })` is one thing a reader can look up. A numbered step's
  number is not one of its four.
- **An arrow label is at most three words.** A sequence numbers its steps.
- **At most twelve boxes per diagram.** One idea per diagram. A framed area — a panel, a group,
  a legend swatch — is not a box: it carries its heading beside itself rather than bound inside
  it, which is also how the checker tells the two apart.
- **A legend only where colour carries meaning**, in the colours below.
- **The title is the diagram's name**, with the one-line subtitle under it, at most twelve words.
- A fact that is needed to read the picture becomes an arrow label, a subtitle or a legend entry.
  Everything else goes in the paragraph for that diagram, below. It is not shrunk into a smaller
  font; it is moved.

```sh
node tools/diagrams/check-text-budget.mjs
```

reads the scenes and fails on a box over the budget, on a box carrying more than one line under
its name, on a scene over twelve boxes, and on any text element anywhere past twelve words. It
needs no browser, and `pnpm diagrams:check` runs it first, before it renders anything.

## Editing a diagram

1. Open `tools/diagrams/scenes/<name>.excalidraw` on <https://excalidraw.com> (**Open** in the
   menu, or drag the file onto the canvas). `docs/diagrams/<name>.svg` opens there too: the
   scene travels inside the SVG, so the committed figure is also the editable source.
2. Change it. Keep to the text budget above and the conventions below — the eleven are meant to
   read as one set.
3. **Save back to `tools/diagrams/scenes/<name>.excalidraw`**, over the file you opened. Use
   **Save to disk** (or **Export image → Excalidraw** with _Embed scene_); saving to a new name
   leaves the old scene in place and the render will keep using it.
4. Run `pnpm diagrams:render`.
5. Commit the `.excalidraw` and the `.svg` together.

`pnpm diagrams:render --only <name>` rewrites one figure while you iterate.

`tools/diagrams/draft/build-scenes.mjs` lays the eleven scenes out, which is why they share one
grid, one palette and one text size. **Re-running it reproduces every committed scene byte for
byte** — it is deterministic, down to the rough-shape seeds — so it is the ordinary way to change
a diagram:

```sh
node tools/diagrams/draft/build-scenes.mjs   # rewrites all eleven scenes
pnpm diagrams:render
```

It writes every scene, not one, so a change made by hand on excalidraw.com is lost the next time
anyone runs it. Either edit the drafter, or make the hand edit and then put the same change into
the drafter before you commit. The `.excalidraw` files remain what the render reads, and what
`pnpm diagrams:check` compares against.

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

runs the text budget over the scenes, then re-renders every scene into a temporary directory and
compares it with what is committed. It names each figure that differs, and how far into the file
the first difference is:

```
1 committed diagram no longer matches the scene beside tools/diagrams/scenes/:

  - docs/diagrams/lifecycle.svg differs from its scene: committed 58 214 bytes, rendered 58 402 bytes, first difference at byte 1832

Run `pnpm diagrams:render` and commit the scene and the SVG together.
```

It is a separate step, not part of `pnpm check`. It takes about three seconds and needs no
network, but it does need the Chromium above, and `pnpm check` is browser-free — as
`pnpm verify:page` is, and for the same reason. Run `pnpm exec playwright install chromium` once,
or point `PLAYWRIGHT_BROWSERS_PATH` at an install that has one, and then `pnpm diagrams:check`
beside the other checks. Without a browser it stops and the message names that command. The text
budget runs before the browser is launched, so it reports even on a machine with no Chromium.

## Visual conventions

The eleven are one set. A diagram that invents its own colours makes the reader learn them twice.

- **Hand-drawn.** `roughness: 1`, stroke `#1e1e1e`. Labels in Excalifont (`fontFamily: 5`);
  anything that is spelled exactly as it is on disk — a file name, a module specifier, a call,
  an error code — in Comic Shanns (`fontFamily: 8`). Those are the two faces the package
  embeds, so they are the two that survive in the SVG.
- **One hue per concern, in all eleven**, from Excalidraw's own palette:

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

- **Size.** Between 1310 x 545 and 1470 x 770, except `adapters`, which stacks four bands and is
  1400 x 1160. The diagram's own name is a 28 px text element at the top left, with a one-line
  subtitle under it in grey at 16 px. A box's name is 12–17 px and its subtitle 12 px; a panel
  heading is 17 px and its caption 13 px.
- **Transparent background.** No page-coloured rectangle behind anything.
- **Arrows.** Bound at both ends, so moving a box takes its arrows with it. A bent arrow has
  sharp corners: Excalidraw's proportional rounding is a fraction of the segment length, so a
  long elbow rounds itself into a loop. Arrows are labelled where the order or the meaning is
  not obvious from the shapes, in three words or fewer.
- Nothing decorative. Every box on a diagram is something a reader can look up in the code.

## What each diagram draws

The paragraphs below describe each figure in reading order, and then carry the facts the figure
deliberately does not: those sentences used to sit inside the boxes, and they are here because a
box is not where an explanation goes. They are what the docs' text equivalents are written from,
so **a change to a scene is a change to its paragraph**.

| Diagram                | Where it is used                                         |
| ---------------------- | -------------------------------------------------------- |
| `system-at-rest`       | the design map: the deployed topology                    |
| `boot-to-mount`        | the design map: page load to a rendered App              |
| `layers`               | the design map: the packages and the import DAG          |
| `adapters`             | the design map: the neutral host, and one adapter each   |
| `isolation-boundaries` | the design map: what separates a container from the page |
| `app-vs-widget`        | guide 1, the shape: App or Widget                        |
| `config-and-data`      | guide 3, configuration and data                          |
| `lifecycle`            | guide 6, lifecycle                                       |
| `storage-retention`    | guide 7, storage                                         |
| `styling-scope`        | guide 8, styling                                         |
| `dev-workflow`         | guide 9, the daily workflow                              |

### system-at-rest

Subtitle: "What is deployed where, before anyone opens the page." Eleven boxes, read left to
right. A yellow panel **The shell origin** ("dev: http://localhost:3000") holds `index.html` and
a violet `registry.json` ("one record per definition"). A grey dotted arrow labelled
**manifestUrl** leaves `registry.json` for a blue panel **Three container origins** ("each on its
own origin"), which holds `operations` ("an App — dev :3001"), `alert-panel` ("one Widget — dev
:3003") and `insights` ("four Widgets — dev :3004"). A second grey dotted arrow, **publishes**,
runs from that panel to a panel **Every container publishes** ("the same four files each time")
holding four violet tiles: `mf-manifest.json`, `remoteEntry.js`, `styles.css` and
`runtime-config.json`. A blue dotted arrow labelled **names the API** drops from
`runtime-config.json` to an orange panel **The API** ("dev: http://localhost:3010") holding
`GET /api/assets`. Bottom left is a grey dashed box **The browser page** ("one document, from the
shell origin"); a black dashed arrow labelled **served from** points from it up to the shell
origin, and a grey dashed arrow labelled **fetched into** points from the published files down to
it. A legend names the five colours.

Not on the figure: a registry record carries an id, a container name and a `manifestUrl`, and
nothing else the shell needs before the first load. Each container is deployed on its own origin
and its own release train; the shell learns one exists only from `registry.json`. Every container
above is fetched into that one browser document — its chunks, its stylesheet and its
configuration — so "three origins" is a deployment fact, not a runtime one. `runtime-config.json`
is what names the API for a container: the generated `#mfe/fetch` resolves a relative request
against the base URL it supplies and attaches the shell's session token to the origins declared
`{ api: true }`, and to no others.

### boot-to-mount

Subtitle: "Page load to a rendered App, in the order the code runs." Twelve boxes: seven numbered
steps in two columns, and five red error codes. The left column, headed "In the shell —
apps/shell/src/boot.tsx": **1. The document boots** (`apps/shell/src/boot.tsx`), **2.
Diagnostics, then session** (`installShellAuth({ tokens, diagnostics })`), **3. The registry
arrives** (`await fetch('/registry.json')`), **4. Runtime reads the registry**
(`createMfeRuntime, then readRegistry`). An arrow leaves step 4, turns up the gutter and
enters the top of the right column, headed "In the framework — @company/mfe-react": **5. URL
picks the boundary** (`<AppHost appId='operations' basePath='/operations'>`), **6. The container
loads once** (`loadRemote('operations/app')`), **7. The App renders** (`useOwnedMount, then
RouterProvider`). Two red dashed arrows, each labelled **thrown**, leave steps 6 and 7 for two
dashed panels on the right: **When step 6 fails**, holding `load/manifest-failure`,
`load/entry-failure` and `registry/invalid-entry`; and **When step 7 fails** ("caught, and
drawn with a Retry"), holding `app/invalid-base-path` and `app/invalid-router`.

Not on the figure. The twelve steps this used to draw are folded into seven, and the detail is
here. `index.html` has already set the theme before first paint. The diagnostics hub is built
before the runtime because `installShellAuth` runs before a runtime exists to report into, and
the runtime adopts that hub rather than making one; the session is installed before any remote is
registered. A registry that fails to load is a diagnostic, not a crash. `createMfeRuntime` reads
the developer overrides before anything registers, then reads every entry on its own, so one
malformed entry is rejected and loses only itself. The shell claims exactly one path segment,
`/$appId`, and renders nothing of its own below the boundary. A container is loaded once per
runtime and the load is shared by every waiter. The mount is made by the effect that ends it, and
the router factory is called once per mount and then checked — the `basePath` passed through
unchanged, the supplied history itself. When a step fails, the error is caught by the
`RetryBoundary` and handed to the fallback slot as `{ error, retry }`: the shell draws
"operations could not be loaded", the message the error carries, its code, and a Retry button
whose `retry()` forgets the cached load so the next attempt is a genuinely fresh one. The chrome
stays, every other App stays reachable, and one boundary is the whole cost of the failure.

### layers

Subtitle: "The packages, which way the imports point, and who sees them." Twelve boxes in two
dashed regions. The left one, **In the browser** ("an arrow points at what a package depends
on"), holds the dependency graph: `apps/shell` (yellow) and `examples/operations` (blue) on the
top row, `@company/mfe-react` and `@company/mfe-legacy-angular` below them, `@company/mfe-host`
under those two, and `@company/mfe-core` at the bottom. Arrows run shell → mfe-react,
operations → mfe-react, mfe-react → mfe-host, mfe-legacy-angular → mfe-host and
mfe-host → mfe-core. The right region, **At build time** ("one entry in the container's
rsbuild.config.ts"), holds a violet `@company/mfe-rspack` (`pluginMfe()`) and, reached by one
arrow labelled **generates**, a column of five violet tiles: `#mfe/config`, `#mfe/fetch`,
`#mfe/meta`, `.mfe/entries/` and `.mfe/styles.css`. A green dot marks each thing an author writes
or imports: `examples/operations`, `@company/mfe-react`, `#mfe/config` and `#mfe/fetch`. One line
under the graph names the packages that sit beside the DAG rather than in it:
`@company/create-mfe`, `@company/eslint-plugin-mfe`, `@company/mfe-devtools`. The legend names
the four colours and the dot.

Not on the figure: `pnpm boundaries` reads the imports and the manifests, so no arrow can be
reversed by editing a `package.json`; neither `mfe-core` nor `mfe-host` may import React, a
router or Module Federation. `pluginMfe()` is the container's whole build integration —
discovery, the generated modules, the federation options, the asset URLs and the container's own
scoped stylesheet — and it also writes the container's registry entry, `.mfe/mfe-registry.json`,
which is what `registry.json` is assembled from. `@company/create-mfe` writes the App and Widget
starters and imports no framework package, `@company/eslint-plugin-mfe` carries the author and
framework presets, and `@company/mfe-devtools` ships in every build behind one runtime key.

### adapters

Subtitle: "One neutral host; one adapter per framework." Twelve boxes, read top to bottom. At
the top, a yellow **The shell** (`apps/shell/src/boot.tsx`), with an arrow labelled
**registry.json** into a panel **The neutral host** ("@company/mfe-host — no React, no router, no
federation"). That panel holds a grey **Shared services** ("storage, commands, navigation bridge,
diagnostics") and, under it, a dashed inner panel **Reading the registry** ("one adapter
recognises each entry") holding two grey boxes side by side: **Entries with mfe**
(`reactAdapter`) and **Entries without mfe** (`legacyAngularAdapter`). An arrow labelled **read
by** drops from each of them to one of two adapter panels below. **The React adapter**
("@company/mfe-react") holds **Federation loader** (`createMf2ContainerLoader`), **App and Widget
definitions** (`createApp, createWidget`) and **Boundary and style roots**
(`createBoundaryHistory, StyleRoot`). **The legacy Angular adapter** ("@company/mfe-legacy-angular
— removable") holds **Registry translation** ("legacy AppConfig into typed fields"), **Parcel
lifecycle** (`mountRootParcel: mount, unmount`) and
**Base href, shell routes** (`resolveLegacyBaseHref, matchLegacyShellRoute`). An arrow labelled
**loads, mounts** drops from each adapter to the blue container it mounts: `operations` ("a React
App, or Widgets") and `asset-tracker` ("a legacy Angular application"). The legend says which
colour is which: yellow the shell, grey neutral ("no React, no router, no federation"),
transparent an adapter package, blue a container the adapter mounts.

Not on the figure. The host is framework-agnostic by construction: `@company/mfe-core` and
`@company/mfe-host` define the contracts and orchestrate loading, and both are forbidden — by the
lint presets and by `pnpm boundaries` — from importing React, a router, single-spa or Module
Federation (§6). Loading therefore happens through a port: the host declares `ContainerLoader`
and each adapter implements it. Adding a framework is one more adapter. `readRegistry` walks the
raw registry entries and offers each one to every registered adapter's `detect`. Exactly one
adapter must recognise it: none and the entry is rejected as unrecognised, more than one and it is
rejected as ambiguous with both named, so there is no order to register adapters in.
`reactAdapter` is always registered — `createMfeRuntime` adds it to whatever the `adapters` option
names — and it recognises any entry carrying an `mfe` key, however malformed the rest of it is; a
typo in framework metadata is rejected rather than quietly read as legacy (§9).
`legacyAngularAdapter` recognises only entries with no `mfe` key that carry a legacy `name` and
`mfManifestUrl`. Each adapter's `parse` produces a `RegistryEntry` with the same common fields,
and its own fields are typed on its own entry type and reached through its `is()` guard, so no
shell surface has to know which adapter an entry came from. The shared services are the host's and outlive any
one mount: validated storage, the command registry, breadcrumbs, the navigation bridge and the
`DiagnosticsHub`. The React adapter is the only place that knows federation exists: it
registers the remote and loads the expose path, turns what the container exposed into a checked
`createApp`/`createWidget` definition, builds the boundary history over the navigation bridge
rather than by patching `window.history`, and renders the scope root and the container's own
`StyleRoot`. The legacy adapter is the only place that knows the single-spa contract, the legacy
registry vocabulary and the `<name>/single-spa-app` expose path: it translates the legacy
`AppConfig` into the neutral record, preserves the existing loading shape exactly
(`registerRemotes`, `loadRemote`, then the parcel lifecycle through an injected `mountRootParcel`),
resolves each app's base href from the app-pinned or delegated seam, and declares
`navigationOwnership: 'shell'` so the shell keeps the URL and keeps serving the legacy route
patterns. It depends on neither Angular nor single-spa, which is what lets it be tested without
either. Nothing else in the workspace imports it: when the last legacy application is migrated
the directory is deleted, the shell drops one entry from its rules table and one import from its
composition root, and no other package changes.

### isolation-boundaries

Subtitle: "Six boundaries between one mounted container and the page." Seven boxes. A blue **One
mount** ("one token, one basePath, one scope root") sits in the middle, with six grey boxes
around it — three above, three below — each reached by a grey dashed arrow pointing outwards from
the centre. **URL** ("basePath into createRouter; boundary history"), **Styles** ("@scope per
definition; the shell owns preflight"), **Storage** ("<definitionId>:<name>; retention decides
who reads"), **Network** ("#mfe/fetch; the token only to declared origins"), **Errors** ("one
MfeError code, into the DiagnosticsHub") and **Shared singletons** ("one copy per page;
shareStrategy loaded-first").

Not on the figure. Everything around the mount is a seam the framework owns. **URL**: the
`basePath` is assigned by the host and passed straight through to `createRouter({ basepath })`;
the history is built over the navigation bridge by `createBoundaryHistory`, never by
`createBrowserHistory`, which reassigns `window.history.pushState` for everyone. **Styles**: the
container ships only the utilities for its own classes, wrapped by the build in
`@scope ([data-mfe-scope="operations"]) to ([data-mfe-scope])`; the shell keeps the document half
— preflight, the fonts, `@property`, the theme variables. **Storage**: every record goes through
the storage boundary under the key `<definitionId>:<name>`; `retention: 'browser'` is the
default and is never cleared, where `retention: 'user'` is wiped when the identity or the
group set changes; state the page owns rather than any definition goes in the reserved
`@host` scope. **Network**: the generated `#mfe/fetch` resolves a
relative request against the base URL `runtime-config.json` supplied and attaches the shell's
session token to the origins declared `{ api: true }` — an exact scheme, host and port set, with
no wildcards and no substrings. **Errors**: every failure is an `MfeError` carrying a code from a
closed union, the definition id, the operation and the repair; it reaches the shell's
`DiagnosticsHub`, which forwards it to telemetry, and a failed mount costs its own boundary and
nothing else. **Shared singletons**: `react`, `react-dom`, `@tanstack/react-router`,
`@tanstack/react-query` and `@company/mfe-*` resolve once per page through the Module Federation
share scope, and the host declares `shareStrategy: 'loaded-first'` so one unreachable manifest
cannot take the whole page down with it.

### app-vs-widget

Subtitle: "Apps take URLs. Widgets take props. The URL decides." Nine boxes. A diamond at the
top asks **Addressable by a URL?**; two arrows leave it, labelled **yes** and **no**, into two
blue panels. The left panel, **Yes — it is an App** ("routable, independently deployable"), holds
four code tiles joined top to bottom by arrows: `https://shell.example/operations/wells`,
`createApp({ id: 'operations', router })`, `createRouter({ basepath: basePath })` and
`mfeRoute({ appId: 'reports' })`. The right panel, **No — it is a Widget** ("non-routable, many
per page"), holds four the same way: `createWidget({ id: 'alert-panel' })`,
`lazyWidget('alert-panel', { contract })`, `<AlertPanel alertId={id} onAcknowledged={ack} />` and
`<DynamicWidget widgetId={id} {...inputs} />`.

Not on the figure. An App: the shell owns `/operations` and the App owns everything after it;
`createApp` is one call in `src/mfe.ts`, and its `router` is a factory called once per mount;
`basepath` makes every route, `Link` and `navigate` relative to the boundary; and an App
delegates a nested App at a splat route with `mfeRoute`, where `boundaryAboveSplat` strips the
remainder so `reports` is mounted at `/operations/reports` and never learns whether it was
reached on its own or inside another App. A Widget: `inputs` and `events` are Zod schemas the
build reads statically; `lazyWidget` is called at module scope, because the component's identity
is what React uses to decide it is looking at the same element and one built during render
remounts the Widget; inputs arrive as props and events as `onX` props, typed from the contract;
and `DynamicWidget` is for a host that learns which Widgets exist only when it reads the
registry — no contract, so no consumer-side types, every event arriving through
`onEvent(name, payload)`, and the provider still validating every input it is given.

### config-and-data

Subtitle: "From one file per deployment to one authenticated request." Nine boxes. A blue
`src/mfe.config.ts` ("what the author declares") and an orange `runtime-config.json` ("what the
deployment writes") both point at a violet `#mfe/config` ("fetched once, validated, immutable"),
along arrows labelled **the build reads** and **fetched at load**. A red dashed arrow labelled
**or it fails** drops from `#mfe/config` into a dashed panel **When it cannot start** holding
three red tiles: `config/missing`, `config/unreachable` and `config/invalid`. An arrow labelled
**the base URL** runs from `#mfe/config` to a violet `#mfe/fetch` ("standard fetch, never a
patch"), which is also reached from below by an arrow labelled **the token** out of a yellow
`installShellAuth({ tokens })` ("the page's one session"). One last arrow, **one request**, runs
from `#mfe/fetch` to an orange **The API** ("one origin declared { api: true }"). A legend names
the five colours.

Not on the figure. `src/mfe.config.ts` declares keys and their schemas and nothing else —
`env('API_BASE_URL', z.string().url(), { api: true })` — and the build reads those schemas
statically to type `#mfe/config`. `runtime-config.json` sits beside the container's assets and
holds values only: no envelope, and no secret. `#mfe/config` is fetched once and awaited at the
top level of the module, so nothing that imports it runs before it has validated; it is an
immutable snapshot, so changing a value takes a new deployment and a page reload, and nothing
polls; an undeclared key fails rather than being ignored, because it is usually a misspelled one.
The three red codes are the three ways it cannot start: a 404, no answer at all, and a rejected
field. `#mfe/fetch` is `createContainerTransport({ id, apiBaseUrl, apiOrigins })` re-exported as
`fetch` and `getAccessToken` — standard `fetch`, never a patched global. One session serves the
whole page, so a refresh is single-flight across every mount: a second concurrent refresh would
present a credential the server has already retired and sign the user out (§10). The token goes
only to an origin declared `{ api: true }`; any other origin is called without it, and
`auth/undeclared-origin` says so.

### lifecycle

Subtitle: "What a mount does between the first render and the last." Twelve boxes. Five stages in
a row, joined left to right: **the load suspends** (`loadDefinition(runtime, id)`), **the
definition is checked** (`isMfeDefinition, then the router`), **the mount is created**
(`createMount(...)`), the blue **rendered, taking input** (`AppMount / WidgetMount`) and
**disposed** (`dispose()`). A loop arrow leaves the top of the fourth stage and returns to it,
labelled **input, or event**. Red dashed arrows drop from the first, second and fourth stages
into a dashed band **Where a failure goes**, holding six red tiles: `load/manifest-failure`,
`load/entry-failure`, `app/invalid-base-path`, `app/invalid-router`, `contract/input-mismatch`
and `contract/event-mismatch`. Below the band, one grey box **StrictMode** ("create, dispose,
create again"), and to its right a two-entry legend: blue a container, red a failure path.

Not on the figure. **The load suspends**: React Suspense shows the pending slot while the
container is fetched — the shell's "Loading operations", or the pending prop a Widget's consumer
passed; one load per container per runtime, shared by every waiter and cached, a rejection
included; there is no time budget on this path, the load suspends until it settles. **The
definition is checked**: what the container exposed has to be a definition made by `createApp` or
`createWidget`, of the kind the registry entry named, and for an App the router the author's
factory returned is checked too — the `basePath` passed through unchanged, the supplied history
itself, and the supplied context. **The mount is created**: an effect creates it and the same
effect's cleanup destroys it, so one render passes with no mount; it holds a mount token, the
scope root and the style root, an overlay root in the document, a tracer, a Query client, the
definition's two storage areas, and the `AbortSignal` `useMfeSignal` hands the author.
**Rendered**: the App routes inside its own boundary; a Widget validates every committed input
change and every event it emits, and a rejected input keeps the last one that passed and reports
a diagnostic rather than blanking a Widget already on the page. **Disposed**: registrations go
first, so a disposed mount cannot appear in the palette mid-teardown — commands, then the
navigator; then the signal aborts, queries are cancelled and cleared, telemetry ends, and the
overlay root is removed from the document. The first four codes are thrown and caught by the
`RetryBoundary`, which hands the fallback slot `{ error, retry }`; a Widget's first bad input
throws the same way, while a later one is reported as a diagnostic and the last inputs that
passed stay on the page; a render error inside a mounted App reaches that App's own
`defaultErrorComponent`, inside its own boundary, and the host never sees it. StrictMode: in
development React mounts, unmounts and mounts again without re-rendering, which is why the mount
is built by the effect that destroys it — a mount built in `useMemo` is not re-evaluated on the
second setup, so the second setup would run against the object the first cleanup had already
disposed (§14).

### storage-retention

Subtitle: "How a stored key is composed, and who reads it back." Five boxes and one table. Across
the top, three boxes joined by arrows labelled **binds to** and **writes**: a blue
`useStoredState('filters', schema)` ("what the author writes"), a green **What it binds to**
("storage 'local', retention 'browser', version 1") and a green `operations:filters` ("one key, one
versioned envelope"). Below, a panel **What survives what** ("storage keeps it; retention decides
who reads it") holds a table with two columns, `retention: 'user'` and `retention: 'browser'`,
and five rows: the identity changes — wiped / kept; the groups change — wiped / kept; a reload —
kept / kept; the tab closes — gone with it / gone with it; version raised — `migrate()`, or
unreadable / `migrate()`, or unreadable. To the right, a yellow **The page's own
scope** (`@host — bindHost(), hostStorage()`) and a red **retention: 'user'** ("asked for when
the data is personal"). A legend names the four colours.

Not on the figure. The key is `<definitionId>:<name>`, never scoped by mount token, so two mounts
of one definition read one record. The stored value is an envelope —
`{ "v": 1, "r": "user", "g": "<session generation>", "d": { … } }` — and the `g` field fences a
user-retained record to one session generation, absent on a `'browser'` record: a record written
under another generation reads as absent. "The tab closes" is the row for `storage: 'session'`;
with `storage: 'local'` a record outlives the tab, subject to its retention. Outside a mount,
`useStoredState` resolves to the reserved `@host` scope, which no definition can claim because `@`
is not a legal character in a definition id. `retention: 'browser'` is the default: a key that
declares none is never cleared, so every user of this browser profile reads the same value, which
suits a display density or a collapsed panel. `retention: 'user'` is the opt-in for anything
derived from a user's data (§21).

### styling-scope

Subtitle: "One stylesheet in two halves: the document, then the utilities." Six boxes. Across the
top: a yellow `apps/shell/src/styles/app.css` ("preflight, the fonts, the theme variables"), a
violet `.mfe/styles.css` ("this container's utilities, generated"), and — reached by an arrow
labelled **after Tailwind** — a violet **The build wraps it**
(`@scope ([data-mfe-scope="operations"]) to ([data-mfe-scope])`). Below, a grey panel **On the
page** ("while the App is mounted") holds the two elements that matter:
`<div data-mfe-scope="operations" data-mfe-kind="app">` ("the scope root — display: contents")
and `<div data-mfe-scope="operations" data-mfe-overlay-root>` ("the overlay root, at body
level"). A grey dashed arrow labelled **inherits into containers** runs from the shell's
stylesheet down to that panel, and an arrow labelled **scopes every rule** runs from the wrapped
stylesheet to the scope root. To the right, a red **The stated limit** ("@scope, with no fallback
below Chrome 118"). A legend names the four colours.

Not on the figure. The shell's half is the document half — the reset, the fonts and
`--font-sans` / `--font-mono`, the `@property` registrations and the theme variables on `:root` —
and all of it inherits into every container, so no container ships a reset or a variable of its
own. `.mfe/styles.css` imports `tailwindcss/theme.css` and `tailwindcss/utilities.css` by layer,
deliberately not `tailwindcss`, which would bring preflight with it; Tailwind emits a utility only
for a class it has seen, so the file is the CSS for this container and nothing else. The design
system's own plugin does the wrapping, after `@tailwindcss/postcss`: the lower boundary of the
`@scope` rule is the next mount root below, so a nested container's CSS is never this one's;
`:root` and `:host` are rewritten onto the scope root; and `@keyframes` are renamed after this
container, because such names are page-wide whatever scopes the rules. The scope root is
`display: contents`, so it anchors a selector without becoming a box in the layout, and it holds
the container's own `StyleRoot` and the App inside that. The overlay root sits at body level and
carries the same `data-mfe-scope`, which is what keeps every dialog, popover, tooltip and menu
inside the container's scope instead of on a bare document body. The stated limit (§5, §17):
`@scope` has the narrowest support of anything the framework requires and is emitted with no
fallback, so below Chrome 118, Firefox 146 or iOS Safari 17.4 the rule does not apply and the
last stylesheet on the page wins, unscoped.

### dev-workflow

Subtitle: "What pnpm dev starts, and what one edit costs." Twelve boxes. On the left, a yellow
`pnpm dev` (`tools/dev/dev.mjs`) with an arrow labelled **generates** down to a violet
`registry.json` ("written by pnpm run generate"). An arrow labelled **starts** runs from
`pnpm dev`, and a grey dotted arrow labelled **the shell reads** runs from `registry.json`, into
a panel **One dev server each** ("the port is part of the address") holding one tile per process:
`apps/shell :3000` (yellow), `examples/operations :3001`, `examples/reports :3002`,
`examples/alert-panel :3003`, `examples/insights :3004`, `examples/lab :3005` (all blue) and
`tools/dev/api.mjs :3010` (orange). On the right, a green **localStorage override**
("company:mfe:overrides, then a reload") with an arrow labelled **points the shell** back at
`apps/shell :3000`. Below it a panel **Why one edit reloads** ("React Refresh replaces only
component modules") holds a red `src/mfe.ts` ("a definition — the page reloads") and a green
`src/alert-panel.tsx` ("only components — hot-updates in place"). A legend names the six colours.

Not on the figure. `pnpm dev` checks that 3000–3005 and 3010 are free before it starts anything,
because a container's port is part of its address and cannot be moved without the shell losing
it; each container's port comes from its own `package.json` `"mfe"` block, so adding an example
is a one-file change in it. `pnpm dev` runs `pnpm run generate` itself, and the shell learns that
a container exists only from the `registry.json` it writes. The override is the console snippet
`pnpm dev` prints with the real ids and URLs: read `company:mfe:overrides` out of `localStorage`,
set `overrides['operations'] = 'http://localhost:3001/mf-manifest.json'`, write it back and
reload. The reload is not optional — the old container is already registered under the same name,
and disposing a mount does not reach it. `src/mfe.ts` exports a definition and a contract as well
as components, so it is never a refresh boundary and an edit reloads the whole page;
`src/alert-panel.tsx` exports only the component, so it hot-updates in place and keeps the state
the component held (§18). `pnpm hmr:probe <file> [url]` says which of the two happened: the change
appears either way, and only what was lost is different.
