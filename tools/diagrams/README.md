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
  1400 x 945. The diagram's own name is a 28 px text element at the top left, with a one-line
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
| `adapters`             | the design map: the runtime, and the adapters it reads   |
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
enters the top of the right column, headed "In the framework — the adapter, then the runtime":
**5. URL picks the boundary** (`<AppHost appId='operations' basePath='/operations'>`), **6. The
container loads once** (`mountDefinition, then loadRemote('operations/app')`), **7. The App
mounts itself** (`definition.mount(), in its own React root`). Two red dashed arrows, each
labelled **rejects**, leave steps 6 and 7 for two dashed panels on the right: **When step 6
fails**, holding `load/manifest-failure`, `load/entry-failure` and `load/timeout`; and **When
step 7 fails** ("the mount rejects; drawn with a Retry"), holding `app/invalid-base-path` and
`app/invalid-router`.

Not on the figure. `index.html` has already set the theme before first paint. The diagnostics
hub is built before the runtime because `installShellAuth` runs before a runtime exists to
report into, and the runtime adopts that hub rather than making one; the session is installed
before any remote is registered. A registry that fails to load is a diagnostic, not a crash.
`createMfeRuntime` takes every adapter the shell serves, listed, and registers none of its own;
it reads the developer overrides before anything registers, then offers every entry to every
adapter on its own, so one malformed entry is rejected and loses only itself. The shell claims
exactly one path segment, `/$appId`, and renders nothing of its own below the boundary but the
element `AppHost` hands the runtime. `AppHost` calls `mountDefinition` from an effect, and the
runtime does the rest: it resolves the entry — an id the registry does not hold fails as
`registry/invalid-entry` before anything downloads — and loads the container through the one
federation loader, once per runtime, with the load shared by every waiter, run inside the React
adapter's `aroundLoad`, and bounded by the load deadline (30 seconds by default). It then creates
the scope root with the definition's element inside it, and the overlay root, and calls the
definition's `mount`. The React definition opens its own root and calls the router factory once;
the factory's router is then checked — the `basePath` passed through unchanged, the supplied
history itself — and a failure in that first render rejects the mount. A rejected mount moves to
its error state: `AppHost` shows `pending` until then and its `fallback` after, which the shell
draws as "operations could not be loaded", the message, its code, and a Retry button whose
`retry()` loads afresh, because no rejection is kept. The chrome stays, every other App stays
reachable, and one boundary is the whole cost of the failure.

### layers

Subtitle: "The packages, which way the imports point, and who sees them." Twelve boxes in two
dashed regions. The left one, **In the browser** ("an arrow points at what a package depends
on"), holds the dependency graph: `apps/shell` (yellow) and `examples/operations` (blue) on the
top row; the three adapters below them, `@company/mfe-react`, `@company/mfe-angular` and
`@company/mfe-legacy-angular`; `@company/mfe-runtime` under those three; and `@company/mfe-core`
at the bottom. Arrows run shell → mfe-react, operations → mfe-react, each adapter →
mfe-runtime, and mfe-runtime → mfe-core. The right region, **At build time** ("one integration
per framework, one neutral layer"), holds `@company/mfe-rspack` (`pluginMfe(), for React`) and
`@company/mfe-nx` (`withMfe(), for Angular`), both pointing at `@company/mfe-build`
(`planContainer()`), which points at two violet tiles, the first arrow labelled **generates**:
`#mfe/config, #mfe/fetch` and `.mfe/ entries, styles.css`. A green dot marks each thing an
author writes or imports: `examples/operations`, `@company/mfe-react`, `@company/mfe-angular`
and `#mfe/config, #mfe/fetch`. One line under the graph names the packages that sit beside the
DAG rather than in it: `@company/create-mfe`, `@company/eslint-plugin-mfe`,
`@company/mfe-devtools`. The legend names the four colours and the dot.

Not on the figure: the shell also depends on `@company/mfe-angular` (for
`@company/mfe-angular/registry`, which imports no Angular), `@company/mfe-legacy-angular` and
`@company/mfe-devtools`, and every adapter also names `@company/mfe-core`; only the edges that
carry the picture are drawn. An application imports its adapter alone — the root, `/host`,
`/testing` and `/registry` — and lint rejects the core and the runtime in it. `pnpm boundaries`
reads the imports and the manifests, so no arrow can be reversed by editing a `package.json`;
neither `mfe-core` nor `mfe-runtime` may import React, Angular, a router or Module Federation,
and `mfe-core` holds contracts only. `@company/mfe-build` is the framework-neutral half of every
container build — discovery, the generated modules, the share scopes, the stylesheet's PostCSS
chain and the container's registry entry, `.mfe/mfe-registry.json`, which is what
`registry.json` is assembled from; `pluginMfe()` adds what a React container needs to Rsbuild,
and `withMfe()` does the same for an Angular container on Nx's webpack builder. The `#mfe/*`
modules also include `#mfe/meta`. `@company/create-mfe` writes the React App and Widget starters
and imports no framework package, `@company/eslint-plugin-mfe` carries the presets, and
`@company/mfe-devtools` ships in every build behind one runtime key.

### adapters

Subtitle: "One neutral runtime; the adapters the shell lists." Ten boxes, read top to bottom. At
the top, a yellow **The shell** (`adapters: [reactAdapter, angularAdapter, legacyAngularAdapter]`),
with an arrow labelled **registry.json** into a panel **The neutral runtime**
("@company/mfe-runtime — no framework, no federation import"). That panel holds three grey boxes:
**Shared services** ("storage, actions, navigation, diagnostics"), **Federation loader**
(`createFederationContainerLoader`) and **One mount path** (`mountDefinition`). An arrow
labelled **detect, parse** drops into a dashed panel **The adapters** ("exactly one recognises
each entry; any order"), holding **The React adapter** (`mfe.framework 'react'`),
**The Angular adapter** (`mfe.framework 'angular'`) and **The legacy Angular adapter** ("no mfe
key; removable"). An arrow labelled **defines, mounts** drops from each of the first two to a
blue container: `operations` ("a React App, with its own root") and **an Nx container** ("an
Angular App or Widgets"). A dashed arrow labelled **entries only** drops from the legacy adapter
to `asset-tracker` ("a legacy application, not mounted yet"). The legend says which colour is
which: yellow the shell, grey neutral, transparent an adapter package, blue a container.

Not on the figure. The runtime is framework-agnostic by construction: `@company/mfe-core` and
`@company/mfe-runtime` define the contracts and do the loading and mounting, and both are
forbidden — by the lint presets and by `pnpm boundaries` — from importing React, Angular, a
router, single-spa or Module Federation. The federation loader is handed the federation runtime
by the shell, the one file that imports it. `readRegistry` offers each raw entry to every
adapter's `detect`. Exactly one must recognise it: none and the entry is rejected as
unrecognised, more than one and it is rejected as ambiguous with both named, so there is no
order to register adapters in, and none is registered implicitly — the shell lists each one.
`reactAdapter` recognises an entry whose `mfe` marker names `react`, or no framework, however
malformed the rest is; `angularAdapter` one whose marker names `angular`; so a typo in
framework metadata is rejected rather than quietly read by another adapter (§9).
`legacyAngularAdapter` recognises only entries with no `mfe` key that carry a legacy `name` and
`mfManifestUrl`. Each adapter's `parse` produces a `RegistryEntry` with the same common fields,
the two framework adapters through the runtime's one `parseFederatedEntry`, and its own fields
are typed on its own entry type and reached through its `is()` guard. An adapter plugs load
behaviour in through `aroundLoad`, which the runtime runs around its containers' loads only; the
React adapter's hides TanStack Router's development global while a container evaluates. No host
asks which framework built a definition: `AppHost`, `DynamicWidget`, `lazyWidget`,
`<mfe-app-host>` and `<mfe-widget>` all call `mountDefinition`, and the definition mounts itself
— a React one in a React root of its own, an Angular one as an Angular application of its own.
The definition brand is an open string, so a third adapter needs no change to the core, the
runtime or the adapters already here (§6). The legacy adapter translates the legacy `AppConfig`
into the common entry, resolves each app's base href and keeps a tested parcel lifecycle, but no
host mounts a legacy application yet: the shell reads legacy entries and lists them. It depends
on neither Angular nor single-spa, and when the last legacy application is migrated its
directory is deleted, the shell drops one entry from its `adapters` list and one import from its
composition root, and no other package changes.

### isolation-boundaries

Subtitle: "Six boundaries between one mounted container and the page." Seven boxes. A blue **One
mount** ("one token, one basePath, one scope root") sits in the middle, with six grey boxes
around it — three above, three below — each reached by a grey dashed arrow pointing outwards from
the centre. **URL** ("basePath into createRouter; boundary history"), **Styles** ("@scope per
definition; the shell owns preflight"), **Storage** ("<definitionId>:<name>; retention decides
who reads"), **Network** ("#mfe/fetch; the token only to declared origins"), **Errors** ("one
MfeError code, into the DiagnosticsHub") and **Framework share scopes** ("one copy per
framework version; loaded-first").

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
nothing else. **Framework share scopes**: each framework shares in a Module Federation scope
named after its exact installed version, `react@19.3.0` or `angular@19.2.25`, where every
framework-bound package is one strict singleton — so containers on one version share one copy of
React, `react-dom`, `sonner`, the adapter and the TanStack packages, and a container on another
version brings its own set; `@company/mfe-core` and `@company/mfe-runtime` stay page singletons
in `default`. The registry entry lists the scopes as `shareScopes`, the loader registers the
remote with exactly those, and the host declares `shareStrategy: 'loaded-first'` so one
unreachable manifest cannot take the whole page down with it.

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
reached on its own or inside another App. A Widget: `inputSchema` and `outputSchema` are Zod object schemas the
build reads statically; `lazyWidget` is called at module scope, because the component's identity
is what React uses to decide it is looking at the same element and one built during render
remounts the Widget; inputs arrive as props and outputs as `onX` props, typed from the contract;
and `DynamicWidget` is for a host that learns which Widgets exist only when it reads the
registry — no contract, so no consumer-side types, every output arriving through
`onOutput(name, payload)`, and the provider still validating every input it is given.

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

Subtitle: "What a mount does between placement and disposal." Twelve boxes. Five stages in a
row, joined left to right: **the container loads** (`runtime.loader.load(entry)`), **the
definition is checked** (`isMountableDefinition, its kind`), **the roots are created**
(`scope root, createMountContext`), the blue **mounted, taking input**
(`definition.mount(target)`) and **disposed** (`dispose(), then the context`). A loop arrow
leaves the top of the fourth stage and returns to it, labelled **input, or output**. Red dashed
arrows drop from the first, second and fourth stages into a dashed band **Where a failure
goes**, holding six red tiles: `load/manifest-failure`, `load/timeout`, `mount/failure`,
`app/invalid-router`, `contract/input-mismatch` and `contract/output-mismatch`. Below the band,
one grey box **StrictMode** ("first handle disposed; mount runs once"), and to its right a
two-entry legend: blue a container, red a failure path.

Not on the figure. Every host drives this through `mountDefinition`, and every stage is the
runtime's, whichever adapter built the definition. **The container loads**: the host shows its
`pending` slot; the load is shared by every waiter and kept once it resolves, a rejection never
is, and it runs under the load deadline (30 seconds by default), failing as `load/timeout`. **The
definition is checked**: what the container exposed has to be a mountable definition of the
kind the registry entry named, or it fails as `load/entry-failure`. **The roots are created**:
a `display: contents` scope root carrying `data-mfe-scope`, `data-mfe-mount` and
`data-mfe-kind`, with the definition's element inside it, and a mount context holding a mount
token, the depth, an overlay root in the document, telemetry, the definition's two storage
areas and the `AbortSignal` an author is handed. **Mounted**: the definition's `mount` runs
after an `await`, under the mount deadline; a React definition opens its own root, with its own
Query client, and an App's router is checked in the first render — `app/invalid-base-path` and
`app/invalid-router` reject the mount there. Inputs reach a Widget only when they changed; a
Widget validates every input set and every output it emits, and a rejected input keeps the last
one that passed and reports a diagnostic rather than blanking a Widget already on the page. A
render error after the first commit goes to `onFailure` and moves the mount to its error state;
a render error inside an App's routes reaches that App's own `defaultErrorComponent` instead,
and the host never sees it. **Disposed**: the definition's `dispose` empties its element, then
the context goes — registrations first, so a disposed mount cannot appear in the palette
mid-teardown, then the signal aborts (cancelling the mount's queries), telemetry ends and the
overlay root is removed — each step under the dispose deadline. A failed load or mount shows in
the host's `fallback` with a `retry`, which acts only from the error state and loads afresh
after a failed load. StrictMode: in development React mounts, unmounts and mounts again without
re-rendering, so the effect that calls `mountDefinition` disposes the first handle before its
load settles, and the definition's `mount` runs once (§14).

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

Not on the figure. `pnpm dev` checks that 3000–3007 and 3010 are free before it starts anything,
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
