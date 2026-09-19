# MFE framework

A micro-frontend framework for a TanStack React shell, with two author models:

- an **App** is a routable, independently deployable product surface;
- a **Widget** is a non-routable, independently mountable embedded surface.

The guiding rule is that every micro-frontend concern is expressed through a
mechanism TanStack Router already has, or is invisible. An App author should be
writing a TanStack Router application: deployment, loading, style isolation and
federation plumbing stay behind the entry and the build integration.

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

### One thing to know before you store anything

`useStoredState` takes a `retention`, and it decides **who can read the value
back**:

```ts
const [filters, setFilters] = useStoredState('filters', schema, {
  defaultValue: { status: 'open' },
  // retention: 'user' is the default — cleared when the signed-in identity
  // or group set changes, so the next person to sign in starts clean.
})
```

`retention: 'browser'` opts out of that: the framework never clears it, which
also means **every user of that browser profile reads the same value**. It is
for genuinely impersonal state — a display density, a collapsed panel — and
never for anything derived from a user's data.

The default is the safe one, so the only way to leak state between users is to
ask for it.

---

## The examples

Five containers, all mounted by one shell, each on its own dev server:

| Container              | Port | What it is                                                                  |
| ---------------------- | ---- | --------------------------------------------------------------------------- |
| `examples/operations`  | 3001 | an App: overview, assets over the authenticated fetch, wells, settings      |
| `examples/reports`     | 3002 | an App, reached on its own and delegated inside Operations at a splat route |
| `examples/alert-panel` | 3003 | one Widget                                                                  |
| `examples/insights`    | 3004 | four Widgets in one container, because they change together                 |
| `examples/lab`         | 3005 | an App with one page per framework feature and a control for each           |

---

## Running it

### Prerequisites

- **Node 22.12 or newer.** The build and the tooling run TypeScript sources
  directly, which needs Node's type stripping.
- **pnpm 10 or newer.** The repository is a pnpm workspace and uses `catalog:`
  versions. No `packageManager` field pins it, deliberately (`docs/decisions.md`
  8).
- **The Tecton design system, checked out beside this repository.** The shell
  depends on it through a link:

  ```
  <parent>/
    mfe-framework-claude/      this repository
    tecton-ui-1/               git clone of the design system
  ```

  Without it `pnpm install` still reports success — pnpm creates the link and
  does not check that the target exists — and the shell fails later on an
  unresolvable `@tecton/react` import. If you only want the framework packages
  and the examples, everything except `apps/shell` builds and tests without it.

### From a clean clone

```sh
pnpm install
pnpm run generate   # the #mfe/* modules, route trees and the shell registry
pnpm dev            # the shell, every example and the dev API
```

Then open <http://localhost:3000>:

| Page                    | What it shows                                                             |
| ----------------------- | ------------------------------------------------------------------------- |
| `/`                     | the widget dashboard — drag Widgets from three containers onto one canvas |
| `/operations`           | an App, with a Widget from another container inside it                    |
| `/operations/reports/…` | a second App delegated inside the first, reading its own URL              |
| `/lab`                  | one page per framework feature, each with a control that makes it visible |

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
so disposing a mount touches none of that. The shell shows a visible indicator
while any override is active.

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

- Ports 3000–3005 and 3010 must be free, and `pnpm dev` checks that before it starts
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

| Package                       | Responsibility                                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@company/mfe-core`           | Neutral contracts: identity, lifecycle, structured errors, Widget contracts, telemetry and tracing types, storage envelopes. No React, router, single-spa or federation dependency.                                                             |
| `@company/mfe-host`           | Neutral orchestration: registry normalization and adapter selection, mount lifecycle with deadlines, shell state, validated storage, commands, breadcrumbs, the navigation bridge, auth. No React, router, single-spa or federation dependency. |
| `@company/mfe-react`          | The author and host surface, the TanStack Router adapter, and the federation loader.                                                                                                                                                            |
| `@company/mfe-rspack`         | `pluginMfe()`: discovery, generated modules, scoped CSS, asset URLs, federation plumbing.                                                                                                                                                       |
| `@company/mfe-legacy-angular` | The removable legacy adapter.                                                                                                                                                                                                                   |
| `@company/eslint-plugin-mfe`  | Shared lint presets and MFE-specific rules. Development-only.                                                                                                                                                                                   |

The import DAG is enforced mechanically by `pnpm boundaries`, which reads both
source imports and package manifests, so a forbidden dependency cannot be added
by editing a manifest alone.

```
        mfe-core
           ^
           |
        mfe-host
        ^      ^
        |      |
  mfe-react   mfe-legacy-angular
```

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
  — the presets and the four framework-specific rules.

---

## Status

This repository implements the framework contract, the neutral host, the React
adapter, the build plugin, the lint tooling and the shell, with the example
micro-frontends that exercise them.

Two scope limits are worth stating plainly rather than discovering later:

1. **Legacy Angular compatibility is proven against contract fixtures, not the
   real applications.** The legacy repositories are not available here. The
   translation, the parcel lifecycle shape, baseHref delegation, the shell-owned
   routes and the no-silent-fallback guarantee are all tested; that the real
   Asset Tracker and Rigstream applications mount and navigate correctly is not,
   and cannot be until those repositories are available.
2. **The browser support gate currently fails at 89.97% against a 91% target**,
   entirely because of native CSS `@scope`. It was left failing rather than
   tuned to pass, because the remedy is a policy decision.
3. **The page's CSS is the shell's, and the shell scans the containers'
   sources to build it.** That works because every container is in this
   workspace and does not survive containers in separate repositories;
   `docs/decisions.md` §17 records what a real deployment does instead.
