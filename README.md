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

| Concept                      | What it is                                           |
| ---------------------------- | ---------------------------------------------------- |
| `createApp` / `createWidget` | one call in `src/mfe.ts`                             |
| `id`                         | a stable string                                      |
| your route tree              | ordinary TanStack Router                             |
| `#mfe/config`                | generated, typed configuration                       |
| `#mfe/fetch`                 | standard `fetch` with authenticated request handling |

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
pnpm dev            # the shell plus every example, each on its own port
```

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

Other entry points:

```sh
pnpm dev:shell     # the shell alone
pnpm dev:mfes      # the examples alone, against a shell you started yourself
pnpm check         # generate, format check, lint, typecheck, boundaries, tests
pnpm verify:page   # boots everything and asserts in a real browser that a
                   # container mounted and a Widget from a second container
                   # mounted inside it
```

`pnpm verify:page` drives Chromium through Playwright. `pnpm install` does not
download a browser; run `pnpm exec playwright install chromium` once, or point
`PLAYWRIGHT_BROWSERS_PATH` at an existing install. Nothing else needs it.

### Windows

Everything above works on Windows. Two things to know:

- Ports 3000–3003 must be free. A dev server that did not shut down cleanly
  keeps its port, and the next run fails to bind.
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
- [`apps/shell/README.md`](apps/shell/README.md) — the test shell.
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
