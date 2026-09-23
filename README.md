# MFE framework

A micro-frontend framework for a TanStack React shell, with two author models:

- an **App** is a routable, independently deployable product surface;
- a **Widget** is a non-routable, independently mountable embedded surface.

Apps and Widgets are written in React, or in zoneless Angular 19 through the
Angular adapter and its Nx generator, and any host places any of them: every
definition mounts itself, in a root of its own, through one runtime function,
`mountDefinition`.

The guiding rule is that every micro-frontend concern is expressed through a
mechanism the author's router already has, or is invisible. An App author should
be writing a TanStack Router (or Angular Router) application: deployment,
loading, style isolation and federation plumbing stay behind the entry and the
build integration.

**Apps take URLs. Widgets take props.** Anything that cannot be expressed as a
URL is a Widget, not an App.

---

## The whole getting-started surface

| Concept                        | What it is                                           |
| ------------------------------ | ---------------------------------------------------- |
| `createApp` / `createWidget`   | one call in `src/mfe.ts`                             |
| `id`                           | a stable string                                      |
| your route tree                | ordinary TanStack Router                             |
| `#mfe/config`                  | generated, typed configuration                       |
| `#mfe/fetch`                   | standard `fetch` with authenticated request handling |
| `lazyWidget` / `DynamicWidget` | consuming a Widget by name, or by value              |

Everything else is discovered when a need arises and is absent from the
quickstart.

### An App

```ts
// src/mfe.ts
import { createApp, type AppRouterOptions } from '@company/mfe-react'
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

function makeRouter({ basePath, history, context }: AppRouterOptions) {
  return createRouter({
    routeTree,
    basepath: basePath,
    history,
    context: { ...context },
    defaultPreload: 'intent',
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>
  }
}

export default createApp({ id: 'operations', version: '2.1.0', router: makeRouter })
```

The App owns its router. The framework supplies the boundary history and the
route-callback context; everything else is the author's. The base path never
appears again — `basepath` makes every route, `Link` and `navigate` relative, so
authors write ordinary absolute-looking paths.

### A Widget

```tsx
export const alertPanelContract = {
  inputs: z.object({ alertId: z.string() }),
  events: { acknowledged: z.object({ alertId: z.string() }) },
}

export const alertPanel = createWidget({
  id: 'alert-panel',
  ...alertPanelContract,
  render: ({ inputs, emit }) => (
    <button onClick={() => emit('acknowledged', { alertId: inputs.alertId })}>Acknowledge</button>
  ),
})
```

Consuming one looks like an ordinary lazy component — inputs are props, events
are `onX` props:

```tsx
const AlertPanel = lazyWidget('alert-panel', { contract: alertPanelContract })

<AlertPanel alertId={id} onAcknowledged={event => acknowledge(event.alertId)} />
```

`lazyWidget` is called at module scope, because the component's identity is what
React uses to decide whether it is looking at the same element. A host that only
learns which Widgets exist when it reads the registry cannot do that, so it uses
`DynamicWidget` and passes the id as a prop:

```tsx
<DynamicWidget widgetId={tile.widgetId} {...tile.inputs} />
```

That form has no contract and therefore no consumer-side types; the provider
still validates every input and every event payload. What the host needs in
order to ask for the inputs at all — the schema, and the event names — is
published by the Widget's build into the registry, which is how the shell's
dashboard renders a form for a Widget it has never imported.

A host that knows those names only as strings takes every event through
`DynamicWidget`'s `onEvent(name, payload)` instead, alongside any `onX` props.

### One thing to know before you store anything

`useStoredState` takes a `retention`, and it decides **who can read the value
back**. The default is `'browser'`: the framework never clears the record, so it
survives a sign-out and **every user of that browser profile reads the same
value**. That suits the common case — a display density, a collapsed panel, a
chosen tab.

Anything derived from a user's data must say so:

```ts
const [filters, setFilters] = useStoredState('filters', schema, {
  defaultValue: { status: 'open' },
  // Cleared when the signed-in identity or group set changes, so the next
  // person to sign in starts clean.
  retention: 'user',
})
```

State the **host page** owns rather than any definition on it — a theme, a
composed dashboard — goes in the reserved `@host` scope, which `useStoredState`
binds when called outside a mount.

---

## If you are writing the host

A shell is the one consumer that reads the registry instead of being listed in
it. What it gets is deliberately small, and never anything renderable: the icon,
the fallback title and the tone that marks an override stay the host's.

| You need                             | What there is                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| to list what the registry holds      | `useRegistryEntries`, `useApps`, `useWidgets`, `useCapabilityPages(name?)`               |
| to know which App a URL is inside    | `useActiveDefinition(pathname)`, or `boundaryDefinitionId(url)`                          |
| where an App keeps a capability page | `capabilityRoute(entry, name)`                                                           |
| what a Widget takes                  | `describeWidgetInputs(contract)`, `defaultInputsFor`, `coerceInputs`, `needsInputPrompt` |
| to store what the page owns          | `useStoredState` outside a mount, or `bindHost` / `hostStorage`                          |
| to register the page's own commands  | `useCommand` outside a mount, or `CommandRegistry.registerHost`                          |
| the federation options for a host    | `hostFederation({ root })`, from `@company/mfe-rspack/federation`                        |

A React shell boots from `@company/mfe-react/host`, which re-exports the whole
runtime beside `MfeProvider`, and lists every adapter it reads the registry
through — `createMfeRuntime({ adapters: [reactAdapter, angularAdapter, legacyAngularAdapter] })`,
with the two framework adapters from their packages' `/registry` entries,
which import no framework. None is registered
implicitly, and a shell never imports `@company/mfe-core` or
`@company/mfe-runtime` itself; lint rejects both. `AppHost` and `DynamicWidget`
place Angular definitions exactly as they place React ones, and show a `pending`
slot instead of suspending.

Chrome rendered above every mount is a first-class caller: `useTheme`,
`useUser`, `useGroups`, `useBreadcrumbs`, `useCommand` and `useStoredState` all
work outside one, given an `MfeProvider` above them, resolving to `@host` when
they register or store. So the shell needs no store of its own before the
runtime: `createMfeRuntime` builds one, establishes the first session
generation for the identity in `shellState`, and adopts an existing
`diagnostics` hub — `new DiagnosticsHub([telemetryDiagnosticsSink(provider)])`
— that `installShellAuth` can already report into.

---

## The examples

The containers, all mounted by one shell, each on its own dev server:

| Container              | Port | What it is                                                                  |
| ---------------------- | ---- | --------------------------------------------------------------------------- |
| `examples/operations`  | 3001 | an App: overview, assets over the authenticated fetch, wells, settings      |
| `examples/reports`     | 3002 | an App, reached on its own and delegated inside Operations at a splat route |
| `examples/alert-panel` | 3003 | one Widget                                                                  |
| `examples/insights`    | 3004 | four Widgets in one container, because they change together                 |
| `examples/lab`         | 3005 | an App with one page per framework feature and a control for each           |
| `examples/fieldwork`   | 3007 | an Angular App with PrimeNG, generated by `@company/mfe-nx` and built by Nx |

---

## Running it

### Prerequisites

- **Node 22.18 or newer.** The build and the tooling run TypeScript sources
  directly, which needs Node's type stripping — on by default from 22.18.
- **pnpm 10 or newer.** The repository is a pnpm workspace and uses `catalog:`
  versions. No `packageManager` field pins it, deliberately (`docs/decisions.md`
  8).
- **The Tecton design system, checked out and built.** Every package links
  it through one override in `pnpm-workspace.yaml`, which by default expects
  it beside this repository:

  ```
  <parent>/
    mfe-framework-claude/      this repository
    tecton-ui-1/               git clone of the design system
  ```

  It has to be on a revision that ships `@tecton/react` 0.1.0 or newer, whose
  `styles/scoped.css`, `tecton/theme-root`, `postcss/scope` and
  `federation/shared` this framework composes (`main`, or its
  `claude/dazzling-hamilton-cq73dq` branch until that lands), and it has to be
  built:

  ```sh
  cd ../tecton-ui-1 && pnpm install && pnpm --filter @tecton/react build
  ```

  To keep it somewhere else, change the `'@tecton/react': link:…` override in
  `pnpm-workspace.yaml` and run `pnpm install`. The tooling, the Vitest config
  and CI all read the location from that line; CI clones the repository named
  in `.github/actions/setup/action.yml`.

  pnpm creates the link without checking that its target exists, so
  `pnpm install` here reports success either way, and `requireTecton` is what
  says the checkout is missing or unbuilt. Only the framework packages under
  `packages/` build and test without it.

### From a clean clone

```sh
pnpm install
pnpm run generate   # the #mfe/* modules, route trees and the shell registry
pnpm dev            # the shell, every example and the dev API
```

Then open <http://localhost:3000>:

| Page                    | What it shows                                                                |
| ----------------------- | ---------------------------------------------------------------------------- |
| `/`                     | the widget dashboard — drag five Widgets from two containers onto one canvas |
| `/operations`           | an App, with a Widget from another container inside it                       |
| `/operations/reports/…` | a second App delegated inside the first, reading its own URL                 |
| `/lab`                  | one page per framework feature, each with a control that makes it visible    |

The header's registry button (or ⌘K → "Open the registry") shows every entry
the shell accepted, every entry it rejected, and why.

`pnpm dev` runs generation itself, so the middle step is only needed when you
want editor types before starting anything — a fresh clone has no
`routeTree.gen.ts` and no `.mfe/`, so an editor opened on it reports errors
until something generates them. It is also the one documented recovery command
when generated output looks stale.

`pnpm dev` prints the `localStorage` snippets that point the shell at the local
dev servers, with real ids and real URLs. Changing an override requires a page
reload: the old container's modules are already registered in the federation
runtime under the same name, and its chunks and stylesheets are document-level,
so disposing a mount touches none of that. Nothing on the page says an override
is active unless the developer tools are on, where the trigger carries a mark
and the Overrides tab names each one; the bug report carries them either way
(`docs/decisions.md` §23).

`pnpm dev` also starts a small stand-in API on port 3010, because a container
whose requests all fail demonstrates nothing about the request boundary — the
base URL it resolves against, the token it attaches and the origin allowlist
that decides where the token goes are only observable when a request actually
goes out and comes back. It is in `tools/dev/api.mjs` and is not part of the
framework.

Other entry points:

```sh
pnpm dev:shell     # the shell alone
pnpm dev:mfes      # the examples alone, against a shell you started yourself
pnpm check         # generate, format check, lint, typecheck, boundaries, tests
pnpm verify:page   # boots everything and asserts in a real browser that a
                   # container mounted, that a Widget from a second container
                   # mounted inside it, and that the shell mounted a Widget it
                   # was never built against
pnpm hmr:probe <file> [url]
                   # against servers you already started: does editing that file
                   # hot-update the page, or reload it?
```

`pnpm hmr:probe` exists because the two are hard to tell apart by eye — the
change appears either way, and only what was lost is different. It puts a value
on `window` that a reload cannot carry, edits the file, and says which happened.

One authoring rule follows from it. React Refresh replaces a module only when
every one of its exports is a component, and `src/mfe.ts` exports a definition
and its contract by contract — so a Widget whose render function is written
inline in the entry reloads the page on every edit. Keep the render in its own
module (`examples/alert-panel/src/alert-panel.tsx`) and it hot-updates.

The build keeps its side of that bargain by generating the same bytes from the
same sources: it regenerates before every compilation and the container imports
what it generates, so a timestamp in a generated module would make every
compilation a source change and the container would rebuild forever
(`docs/decisions.md` §19).

`pnpm verify:page` drives Chromium through Playwright. `pnpm install` does not
download a browser; run `pnpm exec playwright install chromium` once, or point
`PLAYWRIGHT_BROWSERS_PATH` at an existing install. Nothing else needs it.

### Windows

Everything above works on Windows. Two things to know:

- Ports 3000–3007 and 3010 must be free, and `pnpm dev` checks that before it starts
  anything. A container's port is written into the shell's registry by
  generation, so it is part of its address: a container cannot be moved to
  another port without the shell losing it. The usual cause is a dev server
  from an earlier run that did not shut down — `netstat -ano | findstr :3001`
  names the process, `taskkill /PID <pid> /F` stops it.
- Generated output (`.mfe/`, `routeTree.gen.ts`, `apps/shell/public/registry.json`)
  is not in version control. If a build behaves as though a file is missing,
  `pnpm run generate` is the fix.

---

## Packages

| Package                       | Responsibility                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@company/mfe-core`           | Contracts only: identity, lifecycle types, structured errors, Widget contracts, telemetry and tracing types, storage envelopes. No state, and no React, Angular, router, single-spa or federation dependency; a lint zone keeps it that way.                                                                                         |
| `@company/mfe-runtime`        | The runtime every host and definition shares: reading the registry through the adapters a shell lists, the federation loader, `mountDefinition` (the one mount path), deadlines, shell state, validated storage, commands, breadcrumbs, the navigation bridge, auth. No React, Angular, router, single-spa or federation dependency. |
| `@company/mfe-react`          | The React adapter: the author and host surface, the TanStack Router adapter; `/host` re-exports the runtime with `MfeProvider`, `/registry` is `reactAdapter` alone.                                                                                                                                                                 |
| `@company/mfe-angular`        | The Angular 19 adapter: the author and host surface, zoneless, UI-library agnostic; `/host` re-exports the runtime with `provideMfeRuntime`, `/registry` is `angularAdapter` alone.                                                                                                                                                  |
| `@company/mfe-build`          | The neutral build layer shared by every build integration: discovery, generated modules, the container's own scoped stylesheet, asset URLs, federation plumbing and one share scope per framework version.                                                                                                                           |
| `@company/mfe-rspack`         | `pluginMfe()`: the React containers' Rsbuild integration, built on `@company/mfe-build`, and `hostFederation()` for a React shell.                                                                                                                                                                                                   |
| `@company/mfe-nx`             | The `app` and `widget` Nx generators, which scaffold an Angular container with PrimeNG, and `withMfe()` on Nx's Angular webpack builder, built on `@company/mfe-build`.                                                                                                                                                              |
| `@company/mfe-devtools`       | The developer tools overlay: a flag-gated, lazy-loaded panel that writes the boot-time manifest overrides and shows what the registry accepted or rejected.                                                                                                                                                                          |
| `@company/mfe-legacy-angular` | The removable legacy adapter. It reads legacy registry entries; no host mounts a legacy application yet.                                                                                                                                                                                                                             |
| `@company/eslint-plugin-mfe`  | Shared lint presets and MFE-specific rules: a neutral root, `/react` and `/angular`, with each framework's lint plugins as optional peers. Development-only.                                                                                                                                                                         |
| `@company/create-mfe`         | `pnpm create @company/mfe <directory>`: the App and Widget starters. Writes files and imports no framework package.                                                                                                                                                                                                                  |

The import DAG is enforced mechanically by `pnpm boundaries`, which reads both
source imports and package manifests, so a forbidden dependency cannot be added
by editing a manifest alone.

```
                        mfe-core
                        ^      ^
                        |      |
              mfe-build        mfe-runtime
              ^      ^          ^    ^    ^
              |      |          |    |    |
    mfe-rspack    mfe-nx   mfe-react  mfe-angular  mfe-legacy-angular
                                ^
                                |
                          mfe-devtools
```

Each arrow is a manifest dependency. `mfe-react`, `mfe-angular`,
`mfe-legacy-angular` and `mfe-rspack` also name `@company/mfe-core` directly,
and `mfe-devtools` also names `@company/mfe-runtime`; only the longest edge is
drawn. `@company/create-mfe` appears in neither direction: it writes files and
depends on no framework package, and `@company/eslint-plugin-mfe` is
development-only.

An application — the shell, an example, a generated container — imports only
its adapter: the root, `/host`, `/testing` or `/registry`. The author presets
and the `application()` lint preset reject `@company/mfe-core` and
`@company/mfe-runtime` anywhere else (`docs/decisions.md` §32).

---

## What to read next

- [`docs/decisions.md`](docs/decisions.md) — the decisions that were forced by
  evidence, including two findings that did not come out the way the design
  hoped: native `@scope` browser coverage is currently below the target, and
  browser async context does not propagate across `await`.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — conventions, and what the checks enforce.
- [`apps/shell/README.md`](apps/shell/README.md) — the shell: the widget
  dashboard, the registry view, and what consuming the design system costs.
- [`packages/eslint-plugin-mfe/README.md`](packages/eslint-plugin-mfe/README.md)
  — the presets and the five framework-specific rules.
- [`packages/mfe-angular/README.md`](packages/mfe-angular/README.md) and
  [`packages/mfe-nx/README.md`](packages/mfe-nx/README.md) — the Angular adapter,
  and scaffolding and building an Angular container in an Nx workspace.

### Documentation

The author documentation is a site of its own in [`apps/docs`](apps/docs):
`pnpm docs:dev` serves it on port 3020 and `pnpm docs:build` builds it. It is a
start-here page, one recipe per task, the How it works pages — the mount
lifecycle, the isolation boundaries, the adapters — and a reference section,
with pages for the Angular adapter and `@company/mfe-nx` beside the React ones,
and [`docs/design.md`](docs/design.md) as the map of how the pieces fit. The
diagrams those pages embed are rendered with `pnpm diagrams:render`.

---

## Status

This repository implements the framework contract, the neutral runtime, the
React and Angular adapters, the build layer with its Rsbuild and Nx
integrations, the lint tooling and the shell, with the example micro-frontends
that exercise them. `tools/interop` mounts React and Angular definitions in each
other's hosts, and two React versions on one page.

Four scope limits are worth stating plainly rather than discovering later:

1. **Legacy Angular compatibility is proven against contract fixtures, not the
   real applications.** The legacy repositories are not available here. The
   translation, the parcel lifecycle shape, baseHref delegation, the shell-owned
   routes and the no-silent-fallback guarantee are all tested; that the real
   Asset Tracker and Rigstream applications mount and navigate correctly is not,
   and cannot be until those repositories are available.
2. **The browser support gate currently fails at 89.97% against a 91% target**,
   entirely because of native CSS `@scope`. It was left failing rather than
   tuned to pass, because the remedy is a policy decision.
3. **Each container ships its own stylesheet, scoped to its mount roots by the
   build**, and the shell keeps only the document-level half — preflight,
   fonts, `@property` registrations and the theme variables — which inherits
   into every container. `docs/decisions.md` §17 records the model and its two
   limits, one of which is the `@scope` support item 2 describes.
4. **Angular containers are built in a separate Nx workspace, and PrimeNG is
   not scoped.** This repository is not an Nx workspace; `examples/fieldwork` is
   a small one of its own, which `@company/mfe-nx` generated and Nx's Angular
   webpack builder builds, and the package's own tests compile a small container
   with real webpack.
   PrimeNG writes unscoped global styles, so every Angular container on a page
   uses the same PrimeNG version and preset (`docs/decisions.md` §31).
