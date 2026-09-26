# Design map

This page is for reading away from the keyboard. It answers five questions, one per section.

- What is deployed, and where?
- What runs between a page load and a rendered App?
- Which package owns which concern?
- How do the adapters fit together?
- What separates one mounted container from the rest of the page?

## What is deployed, and where

![The shell origin with the registry, three container origins, the browser document and the API.](./diagrams/system-at-rest.svg)

**In words.** Titled `system-at-rest`, under "What is deployed where, before anyone opens the page." Eleven boxes, read left to right.

- **The shell origin** (yellow, dev :3000) holds `index.html` and a violet `registry.json`, "one record per definition".
- An arrow **manifestUrl** reaches **Three container origins** (blue), holding `operations` (an App, :3001), `alert-panel` (one Widget, :3003) and `insights` (four Widgets, :3004).
- An arrow **publishes** reaches **Every container publishes**, holding `mf-manifest.json`, `remoteEntry.js`, `styles.css` and `runtime-config.json`.
- An arrow **names the API** drops from `runtime-config.json` to **The API** (orange, dev :3010), holding `GET /api/assets`.
- **The browser page** (grey) sits bottom left, "one document, from the shell origin". An arrow **served from** points up to the shell origin, and an arrow **fetched into** points from the published files down to it. A legend names the five colours.

A **micro-frontend** is one piece of a single web page, built, versioned and deployed on its own by its own team. There are no iframes: the page is one browser document. Each mounted piece renders in a root of its own, in React or Angular, so two framework versions can share the page. One rule decides the shape of a piece. Apps take URLs, Widgets take props.

The **shell** is the application that serves that page. It owns the chrome, the theme, the session and the routes above a boundary, and it mounts Apps and Widgets into itself. It is the only application on the page with no registry entry.

The **registry** is the JSON array the shell fetches at boot, one entry per definition. An entry carries the id, the kind, the framework it was built with, the manifest URL, and the federation container and expose path. It also lists the share scopes its container's shared packages live in. The rest is optional: a version, and either a Widget's published contract or an App's capabilities. Each entry is generated from the container's own build, because a hand-written second copy drifts.

A **container** is one deployable, with its own build, version and origin. It holds one `src/mfe.ts`, exporting at most one App and any number of Widgets. It publishes `remoteEntry.js`, the file that lets a host load code out of another build, described by `mf-manifest.json`. Its scoped stylesheet and its registry entry sit beside them.

`runtime-config.json` is published beside those assets, never built into them. Changing a value takes a new deployment and a reload. The generated `#mfe/fetch` resolves a relative URL against the first field declared `env(…, { api: true })`. The session token reaches those origins and no others, because the shell installs the page's one session ([decision 10](/docs/how-it-works/decisions#10-the-framework-owns-no-session-the-shell-installs-one-and-the-container-binds-to-it)).

| Party       | Owns                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------ |
| the shell   | the document, the theme, the session, the registry fetch, the boundary routes, diagnostics |
| a container | its definitions, its route tree, the classes its CSS needs, its `runtime-config.json`      |
| the build   | the `#mfe/*` modules, the container entry, the federation options, the entry, the CSS      |

## What happens between a page load and a rendered App

![Seven numbered steps from the shell booting to a rendered App, and the two failure panels.](./diagrams/boot-to-mount.svg)

**In words.** Titled `boot-to-mount`, under "Page load to a rendered App, in the order the code runs." Twelve boxes: seven numbered steps in two columns, and five red error codes.

- Left column, "In the shell — `apps/shell/src/boot.tsx`": **1. The document boots**, **2. Diagnostics, then session** (`installShellAuth`), **3. The registry arrives** (`await fetch('/registry.json')`), **4. Runtime reads the registry** (`createMfeRuntime, then readRegistry`).
- An arrow carries step 4 into the right column, "In the framework — the adapter, then the runtime".
- That column holds **5. URL picks the boundary** (`<AppHost appId='operations' basePath='/operations'>`), **6. The container loads once** (`mountDefinition, then loadRemote('operations/app')`) and **7. The App mounts itself** (`definition.mount(), in its own React root`).
- A red arrow **rejects** leaves step 6 for **When step 6 fails**: `load/manifest-failure`, `load/entry-failure`, `load/timeout`.
- A red arrow **rejects** leaves step 7 for **When step 7 fails** ("the mount rejects; drawn with a Retry"): `app/invalid-base-path`, `app/invalid-router`.

Order carries weight at the start. The shell builds the diagnostics hub first, so `installShellAuth` has somewhere to report, and it installs the session before any remote is registered. It then fetches the registry and assembles the runtime, which adopts that hub rather than making one. The shell lists every adapter the runtime reads entries through, and none is registered implicitly. A registry that fails to load is a diagnostic, not a crash.

Every entry is validated on its own, so one malformed entry loses only itself. A **boundary** is the stretch of URL assigned to one App mount. The shell can own `/$appId` for it because a definition id holds only lower-case letters, digits and single hyphens. A failure below that boundary leaves the chrome and every other App reachable.

A container loads once per runtime per id. **Module Federation** is the bundler mechanism that loads code from another build at run time. The runtime shares a load in flight and keeps one that resolved. It never keeps a rejection, so a retry loads afresh. Load, mount and disposal each run under a deadline from `runtime.deadlines`: 30, 30 and 5 seconds unless the shell tunes them. A load that overruns fails as `load/timeout`.

The **mount** is one live instance of a definition: its mount token, base path, telemetry, storage handles, abort signal, scope root and overlay root. Every host creates one the same way. It renders an empty element and calls `mountDefinition` from `@company/mfe-runtime`, whichever framework built the definition, its own included. The runtime loads the definition, creates both roots, and calls the definition's own `mount` with the element inside the scope root. A React definition opens a React root of its own there, with its own Query client. An Angular definition creates an Angular application of its own. In React, the effect that calls `mountDefinition` is the effect that disposes the handle it returns ([decision 14](/docs/how-it-works/decisions#14-a-mount-built-in-usememo-does-not-survive-a-remount-and-strictmode-remounts-everything)). One mount path is [decision 33](/docs/how-it-works/decisions#33-every-host-mounts-every-definition-through-one-path-and-each-framework-version-shares-in-a-scope-of-its-own).

The **definition** is a side-effect-free record. The React adapter therefore checks what the author did with it: `basePath` passed through as `basepath`, the supplied history by identity, `context.mfe` and `context.queryClient` unchanged. A violation fails the first render, which rejects the mount and names the repair. The host shows its `pending` slot until the mount settles. On a failure, its `fallback` receives the error and a `retry`, which acts only after a failure.

## The packages, and which way the imports point

![The framework packages, which way their imports point, and what the build plugin generates.](./diagrams/layers.svg)

**In words.** Titled `layers`, under "The packages, which way the imports point, and who sees them." Twelve boxes in two regions.

- **In the browser** ("an arrow points at what a package depends on"): `apps/shell` and `examples/operations` both point at `@company/mfe-react`. The three adapters, `@company/mfe-react`, `@company/mfe-angular` and `@company/mfe-legacy-angular`, each point at `@company/mfe-runtime`, which points at `@company/mfe-core`.
- A line under the graph names what sits beside it: `@company/create-mfe`, `@company/eslint-plugin-mfe`, `@company/mfe-devtools`.
- **At build time** ("one integration per framework, one neutral layer"): `@company/mfe-rspack` (`pluginMfe(), for React`) and `@company/mfe-nx` (`withMfe(), for Angular`) both point at `@company/mfe-build` (`planContainer()`). It **generates** `#mfe/config, #mfe/fetch` and `.mfe/ entries, styles.css`.
- A green dot marks `examples/operations`, `@company/mfe-react`, `@company/mfe-angular` and `#mfe/config, #mfe/fetch`. The legend names the four colours and the dot.

An arrow in the picture points at what a package depends on. `pnpm boundaries` reads the `src/**` imports and each manifest alike, so a forbidden edge cannot be added by editing a `package.json`.

| Package                       | What it owns                                                                                        | Depends on                              | Never imports                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| `@company/mfe-core`           | Contracts only: identity, errors, Widget contracts, telemetry types, records.                       | nothing                                 | a framework, a router, federation, the runtime                                     |
| `@company/mfe-runtime`        | The registry, the loader, `mountDefinition`, shell state, storage, actions.                         | core                                    | a framework, a router, single-spa, federation                                      |
| `@company/mfe-react`          | The React author API, the host components, the router adapter, `reactAdapter`.                      | core, runtime                           | single-spa, a vendor SDK, the developer tools                                      |
| `@company/mfe-angular`        | The Angular author API, the host components, the router adapter, `angularAdapter`.                  | core, runtime                           | React, TanStack, zone.js, federation, a UI library                                 |
| `@company/mfe-legacy-angular` | The removable legacy adapter. It reads legacy entries, and mounts none yet.                         | core, runtime                           | React, a router, the React adapter                                                 |
| `@company/mfe-build`          | The framework-neutral build: discovery, generated modules, share scopes, CSS.                       | core                                    | a framework, a bundler, the runtime, a design system                               |
| `@company/mfe-rspack`         | `pluginMfe()`: the React build on Rsbuild, over `@company/mfe-build`.                               | core, build                             | —                                                                                  |
| `@company/mfe-nx`             | The `app` and `widget` generators and `withMfe()`: the Angular build on Nx's webpack.               | build                                   | —                                                                                  |
| `@company/mfe-devtools`       | The developer tools overlay, gated on one key.                                                      | core, runtime, the React adapter        | single-spa, a vendor SDK, the build plugin                                         |
| `@company/mfe-agent`          | The shell's connection to the agent over AG-UI: the page's actions as tools, one list of approvals. | core, runtime                           | an adapter, the developer tools, a build package, any agent library but `@ag-ui/*` |
| `@company/create-mfe`         | The React scaffold, `pnpm create @company/mfe <directory>`.                                         | nothing                                 | —                                                                                  |
| `@company/eslint-plugin-mfe`  | The lint presets: a neutral root, `/react` and `/angular`.                                          | nothing                                 | —                                                                                  |
| `apps/shell`                  | The host page: the chrome, the boundary routes, the session.                                        | the three adapters, devtools, the agent | the core and the runtime, directly                                                 |

The build packages run in the build rather than on the page, so they sit outside that graph. `@company/mfe-build` holds the half every framework shares. It reads the sources without running them, then generates the `#mfe/*` modules, the container and App entries, the registry entry and the scoped stylesheet. A React container adds one `pluginMfe()` line to its `rsbuild.config.ts`. An Angular container, scaffolded by `@company/mfe-nx` in an Nx workspace, exports `withMfe()` from its `webpack.config.ts` ([decision 31](/docs/how-it-works/decisions#31-angular-containers-get-an-adapter-of-their-own-built-by-nx-on-webpack)).

An author touches `src/mfe.ts`, the routes, `src/mfe.config.ts`, the generated modules and that one build line. Every application imports its adapter and nothing beneath it: the root, `/host`, `/testing` and `/registry`. That holds for a container, an example, a generated project and the shell alike. The author presets and the `application()` lint preset block the core, the runtime and any deep path ([decision 32](/docs/how-it-works/decisions#32-companymfe-host-is-companymfe-runtime-the-core-holds-contracts-only-and-an-application-imports-only-its-adapter)).

The design rule is one sentence: every micro-frontend concern uses a mechanism the author's router already has, or it stays invisible. Module Federation stays invisible, in the runtime's loader and one shell file ([decision 6](/docs/how-it-works/decisions#6-federation-lives-in-the-react-adapter-not-in-the-neutral-host)). So do the registry JSON, everything under `.mfe/`, the mount token, the scope root, the overlay root and the diagnostics wiring.

## How the adapters fit together

![The shell's registry entering the neutral runtime, the three adapters the shell lists, and the container each one reaches.](./diagrams/adapters.svg)

**In words.** Titled `adapters`, under "One neutral runtime; the adapters the shell lists." Ten boxes, read top to bottom.

- **The shell** (`adapters: [reactAdapter, angularAdapter, legacyAngularAdapter]`) sits at the top, with an arrow **registry.json** into **The neutral runtime** ("@company/mfe-runtime — no framework, no federation import").
- The runtime holds **Shared services** ("storage, actions, navigation, diagnostics"), **Federation loader** (`createFederationContainerLoader`) and **One mount path** (`mountDefinition`).
- An arrow **detect, parse** drops into **The adapters** ("exactly one recognises each entry; any order"): **The React adapter** (`mfe.framework 'react'`), **The Angular adapter** (`mfe.framework 'angular'`) and **The legacy Angular adapter** ("no mfe key; removable").
- An arrow **defines, mounts** drops from the React adapter to `operations` ("a React App, with its own root") and from the Angular adapter to **an Nx container** ("an Angular App or Widgets"). A dashed arrow **entries only** drops from the legacy adapter to `asset-tracker` ("a legacy application, not mounted yet"). The legend names the shell, a neutral package, an adapter package and a container.

The runtime is neutral: `@company/mfe-core` and `@company/mfe-runtime` import no framework, no router and no Module Federation. The core holds the `MfeAdapter` interface and the common `RegistryEntry` shape, and names no framework. The runtime holds everything that is the same for every adapter. That is the registry read, the federation loader the shell hands the federation runtime to, and `mountDefinition`.

`readRegistry` is one pass, and each raw entry is offered to every adapter's `detect`. Exactly one adapter must recognise it. With none, the entry is rejected as unrecognised. With more than one, it is rejected as ambiguous, with both adapters named. Order therefore means nothing. The shell lists every adapter in `createMfeRuntime({ adapters })`, and the runtime registers none of its own.

| Adapter                       | Recognises an entry when                                     | Mounts it with                       | Removable |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------------ | --------- |
| `@company/mfe-react`          | its `mfe` marker names `react`                               | a React root per mount               | no        |
| `@company/mfe-angular`        | its `mfe` marker names `angular`                             | an Angular application per mount     | no        |
| `@company/mfe-legacy-angular` | it has no `mfe` key, and has a `name` and an `mfManifestUrl` | nothing yet: the shell only lists it | yes       |

No host asks which adapter built a definition. `AppHost` and `DynamicWidget` in React, and `<mfe-app-host>` and `<mfe-widget>` in Angular, all call `mountDefinition`. The definition then mounts itself into the element it is given. So a React shell places an Angular Widget the way it places a React one, and an Angular App can host a React one. An adapter adds load behaviour through `aroundLoad`, which the runtime runs around that adapter's loads only. The React adapter uses it to hide TanStack Router's development global while a container evaluates. The definition brand is an open string, so a third adapter needs no change to the core, the runtime or the adapters already there ([decision 6](/docs/how-it-works/decisions#6-federation-lives-in-the-react-adapter-not-in-the-neutral-host)).

The Angular adapter is Angular 19 and zoneless. Every mount is its own application with its own change-detection scheduler, and no container loads `zone.js`. It names no UI library. An Angular container scaffolded by `@company/mfe-nx` brings PrimeNG in its own `src/primeng.ts` ([decision 31](/docs/how-it-works/decisions#31-angular-containers-get-an-adapter-of-their-own-built-by-nx-on-webpack)).

Nothing falls back silently. An entry naming a framework belongs to that framework's adapter, whatever state the rest of it is in. A malformed entry is set aside with a reason, and the registry lists it under `rejected`. Reading it with another adapter instead would let a typo change how an application loads, unseen.

Shared services come from the runtime and are the same for every adapter. One storage store, one action registry, one breadcrumb store, one navigation bridge and one diagnostics hub are built per runtime. A shell screen reads the registry and never asks which adapter an entry came from.

The legacy adapter reads a legacy entry into the same common shape. Its own fields are typed on its own entry type and reached through `legacyAngularAdapter.is(entry)`. It keeps a parcel lifecycle, the base href each application expects and the routes left to the shell. No host mounts a legacy application yet, so the shell reads and lists legacy entries only. Removal is the point of it. When the last legacy application is migrated, delete the package, one entry from the shell's `adapters` list and one import from its composition root. No other package changes. [Legacy Angular applications](/docs/reference/legacy-angular) is the reference for its fields, its lifecycle and its migration edit.

The legacy adapter is built and tested against production-equivalent fixtures and doubles. The real Asset Tracker and Rigstream applications have never been run against it ([decision 9](/docs/how-it-works/decisions#9-legacy-angular-compatibility-is-proven-against-fixtures-not-the-real-applications)).

## The six isolation boundaries

![One mounted App ringed by six boundaries: URL, styles, storage, network, errors, framework share scopes.](./diagrams/isolation-boundaries.svg)

The boundaries keep containers that mean well from colliding by accident. They are not a security model: every container runs in the shell's document with the shell's privileges, and is trusted because the company builds it ([decision 54](/docs/how-it-works/decisions#54-every-container-is-trusted-with-the-shells-privileges-the-boundaries-prevent-accidents)).

**In words.** Titled `isolation-boundaries`, under "Six boundaries between one mounted container and the page." Seven boxes.

**One mount** ("one token, one basePath, one scope root") sits in the middle. One dashed arrow points out to each of the six boxes around it.

- **URL** — "basePath into createRouter; boundary history".
- **Styles** — "@scope per definition; the shell owns preflight".
- **Storage** — "`<definitionId>:<name>`; retention decides who reads".
- **Network** — "#mfe/fetch; the token only to declared origins".
- **Errors** — "one MfeError code, into the DiagnosticsHub".
- **Framework share scopes** — "one copy per framework version; loaded-first".

### URL

The **base path** is the literal string form of the boundary. After `createRouter({ basepath })` it never appears again: every route, `Link` and `navigate` is relative to it. The **boundary history** is hand-built, because `createBrowserHistory()` reassigns `window.history.pushState` for the whole page ([decision 1](/docs/how-it-works/decisions#1-the-boundary-history-is-built-by-hand-because-createbrowserhistory-patches-globals)). An Angular App reads the same boundary through its own location strategy. The shell's own router writes the page's history directly, so it calls `navigator.announce()` after each navigation to tell mounted Apps where the page went.

### Styles

The `@scope` rule buys scope proximity in place of injection order, so two builds that both spell `bg-primary` no longer resolve by parse order. The runtime creates a **scope root** for each mount, carrying `data-mfe-scope`, and a body-level **overlay root** carrying the same attribute. A definition renders inside the first and portals into the second, and adds no root of its own. A React container's build-attached **style root** renders inside the scope root. `@scope` is the narrowest-supported feature the framework requires, at Chrome 118, Firefox 146 and iOS Safari 17.4, with no fallback ([decision 17](/docs/how-it-works/decisions#17-each-container-ships-its-own-stylesheet-scoped-to-its-own-mount-roots)).

PrimeNG is outside this boundary. It writes its components' rules into unscoped style tags in the document head, so every Angular container on a page has to use the same PrimeNG version. Its design tokens are the host's: containers give PrimeNG no preset, and the shell declares the tokens, Open Props and the Material Symbols font page-wide, before the first Angular container mounts ([decision 38](/docs/how-it-works/decisions#38-the-shell-loads-what-every-angular-container-shares-before-the-first-one-mounts)). Its Dialog, ConfirmDialog and Drawer also need an explicit `appendTo` pointing at the mount's overlay root.

### Storage

The key is never scoped by mount token, so two mounts of one definition read the same record. **Retention** says who may read a value back, rather than how long it lives: `'browser'` is the default and is never cleared, where `'user'` is cleared when the session generation changes. `@host` is spelled with an `@` because no definition id can contain one, which is what makes the scope unclaimable ([decision 24](/docs/how-it-works/decisions#24-the-host-page-had-no-storage-scope-and-the-lint-allowlist-was-the-evidence)).

### Network

`#mfe/fetch` is a standard `fetch` bound to one container's **transport**, so a route loader passes its own `signal`. It retries once after a 401 when the request can be replayed, and a 403 passes through untouched, because attaching a token is not authorization. The allowlist has no wildcards: a wildcard would hand the session token to any host the pattern happens to match.

### Errors and diagnostics

The message is composed to a fixed shape: `<id>[@<version>] failed to <operation>[ <path>][: expected …, received ….] <repair>`. The `code` comes from a closed union, so adding one is a deliberate contract change. A sink that throws cannot stop the others, and a hub with no sinks discards everything.

### Framework share scopes

Each framework shares in a Module Federation share scope named after its exact installed version, such as `react@19.3.0` or `angular@19.2.25`. Inside a scope, every framework-bound package is one strict singleton: React, `react-dom`, `sonner`, the adapter and the TanStack packages for React, the Angular packages, RxJS and the adapter for Angular. Containers on the same version download one copy. A container on another version brings its own complete set, so several React or Angular versions can share one page. `@company/mfe-core` and `@company/mfe-runtime` are page singletons in `default`, whatever framework a container uses.

The registry entry lists a container's scopes as `shareScopes`, and the loader registers the remote with exactly those. A second copy inside one scope is the failure this boundary prevents. Both copies look correct on their own, and every framework hook inside the container then reports being rendered outside any mount. A container may add to its framework's candidates and cannot remove one ([decision 33](/docs/how-it-works/decisions#33-every-host-mounts-every-definition-through-one-path-and-each-framework-version-shares-in-a-scope-of-its-own)).

Three costs follow. A container on another React version has its own `sonner`, so its toasts never reach the shell's `Toaster`. `strictVersion` inside a scope still rejects a minor mismatch on a shared package. And the shell no longer shares `recharts`, which it does not install. PrimeNG is never shared at all. The host resolves shares loaded-first, so an unreachable manifest cannot take the page down ([decision 30](/docs/how-it-works/decisions#30-a-host-resolves-shares-against-the-scope-it-has-not-against-every-remote-it-knows)).

## Where to read next

- [Overview](/docs) — App or Widget, and a recipe for each task.
- [The Angular adapter](/docs/reference/angular-adapter) — Angular Apps and Widgets, and hosting from Angular.
- [Legacy Angular applications](/docs/reference/legacy-angular) — the removable adapter, field by field.
- [Glossary](/docs/reference/glossary) — every term on this page, defined once.
- [Decision log](/docs/how-it-works/decisions) — the argument behind each rule stated here.
