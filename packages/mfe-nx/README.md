# @company/mfe-nx

The Angular build integration for MFE containers, as an Nx plugin — the Angular counterpart of
`@company/mfe-rspack`. It carries:

- `withMfe()` (`@company/mfe-nx/webpack`), the `customWebpackConfig` that turns Nx's Angular webpack
  build into a Module Federation 2 remote;
- the `generate` executor (`@company/mfe-nx:generate`), which writes a container's `.mfe/` modules;
- the `app` and `widget` generators, which scaffold a zoneless Angular 19 container with PrimeNG.

The framework-neutral half of the build — discovery, the generated modules and artifacts, the
share-scope machinery, the stylesheet's PostCSS chain — is `@company/mfe-build`; this package states
what makes a container an Angular one (`src/profile.ts`) and wires the result into webpack.

This package is consumed from a **separate Nx workspace**, not from this repository (this
repository is a plain pnpm workspace and is not, and must not become, an Nx workspace).

## Installing in an Nx workspace

```sh
npm install --save-dev @company/mfe-nx
```

The workspace must be on **Nx 20, 21 or 22**: an Angular 19.2 container builds with the
`@nx/angular` of the workspace's own Nx version, and `@nx/angular` 23 requires Angular 20. The
generator refuses any other Nx before writing anything. Verified end to end on Nx 22.7.12.

## Generating a container

```sh
nx g @company/mfe-nx:app my-app --port 3101
nx g @company/mfe-nx:widget my-widget --port 3103
```

`app` (alias `application`) and `widget` (alias `w`) share the same options:

| Option            | Default                        | Notes                                                                                                                             |
| ----------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `name`            | —                              | The Nx project name (positional).                                                                                                 |
| `id`              | kebab-cased `name`             | Lower-case letters, digits and single hyphens. Becomes the federation container name, the storage prefix and the CSS scope value. |
| `directory`       | `apps/<name>`                  | The project root, relative to the workspace root.                                                                                 |
| `port`            | `3101` (app) / `3103` (widget) | The dev server port; recorded in the project's own `mfe.port`.                                                                    |
| `packageName`     | `@example/<id>`                | The generated project's own `package.json` name.                                                                                  |
| `tags`            | none                           | Comma-separated Nx project tags.                                                                                                  |
| `skipFormat`      | `false`                        | Skip running `formatFiles` over the generated files.                                                                              |
| `skipPackageJson` | `false`                        | Do not touch the workspace `package.json` (the project's own manifest still lists its dependencies).                              |

Unless `skipPackageJson` is set, the generator adds the container's dependencies to the workspace
`package.json` — `@nx/angular` at the workspace's own Nx version — and pins the workspace's
TypeScript to 5.8.3 when it is outside the Angular 19.2 compiler's `>=5.5 <5.9`, saying so in the
log: an Nx workspace has one TypeScript for every project in it.

## What gets generated

```
apps/my-app/
  project.json              # generate, build, serve, test, typecheck, lint (see below)
  package.json              # this container's own manifest: mfe.port, mfe.definitions, dependencies
  webpack.config.ts         # export default withMfe()
  eslint.config.ts          # @company/eslint-plugin-mfe/angular, plus the tooling preset for this file
  src/
    index.html              # required by the Angular builder; a remote is never browsed to
    styles.css              # the container's global stylesheet, compiled and scoped by the build
    primeng.ts              # providePrimeNgForMfe(), dark mode bound in an environment initializer
    mfe.ts                  # createApp({ id, version, routes, component, providers })
    mfe.config.ts           # the config schema, with env from @company/mfe-nx/env
    app.component.ts        # the root each mount renders: <router-outlet />
    app.routes.ts           # '' and 'settings' (a capability route, via mfeRouteData)
    overview.component.ts   # p-select and p-button, injectUser()
    overview.component.spec.ts
    settings.component.ts
  .mfe/runtime-config.json  # your local values: served by the dev server, never copied into a build
  tsconfig.json / tsconfig.app.json / tsconfig.spec.json
  vitest.config.mts         # @analogjs/vite-plugin-angular, JIT
  vitest.setup.ts           # import '@angular/compiler', matchMedia for PrimeNG — no zone.js
  .gitignore                # .mfe/*, except !.mfe/runtime-config.json
  README.md
```

`src/primeng.ts` is the container's, not the adapter's: `providePrimeNgForMfe()` routes PrimeNG's
overlays into the mount's overlay root and follows the shell's theme with a class on the mount's
scope and overlay roots. It hands PrimeNG the Aura preset with every token repeated in its dark
scheme: PrimeNG resolves a light variable's references on `:root`, so without the repeat a select
would stay light under a dark scope root while a button went dark. Dialog, ConfirmDialog and Drawer do not read the overlay setting, so each
needs `[appendTo]="mount.overlayRoot"`, with `mount = injectMfeMount()` in the component. PrimeNG
writes unscoped global styles, so every Angular container on a page uses the same PrimeNG version
and preset.

A `widget` project has no routes, configuration or local values; its `src/mfe.ts` calls
`createWidget({ id, version, inputs, events, component, providers })` with the contract exported
separately, `src/<id>.component.ts` renders a `p-button` with signal `input()`/`output()`, and its
`package.json` publishes `exports['./contracts']`. Its `eslint.config.ts` declares its whole `src/`
as its own Widget scope (`widgetScopes: ['src/**']`); an `app` project declares none, since an App
owns its boundary router.

The generated project depends on `@company/mfe-angular` and nothing beneath it: the neutral
`@company/mfe-core` and `@company/mfe-runtime` arrive through the adapter, and the build shares
them on its behalf (see [Sharing](#sharing)).

## Targets

| Target      | Executor                      | Does                                                                                   |
| ----------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `generate`  | `@company/mfe-nx:generate`    | Writes `.mfe/`, and seeds `.mfe/runtime-config.json` with the declared defaults.       |
| `build`     | `@nx/angular:webpack-browser` | `customWebpackConfig: webpack.config.ts`, `polyfills: []`, into `dist/<project root>`. |
| `serve`     | `@nx/angular:dev-server`      | On the project's port, with `Access-Control-Allow-Origin: *` for the shell's origin.   |
| `test`      | `nx:run-commands`             | `vitest run`.                                                                          |
| `typecheck` | `nx:run-commands`             | `tsc --noEmit` over `tsconfig.app.json` and `tsconfig.spec.json`.                      |
| `lint`      | `nx:run-commands`             | `eslint .`, against `@company/eslint-plugin-mfe/angular`.                              |

`build`, `serve`, `test`, `typecheck` and `lint` depend on `generate`, because the `.mfe/` modules
have to exist before webpack, Vitest, `tsc` or ESLint's `#mfe/*` imports can resolve them. The
build's `main` names the generated entry stub, and every configuration copies all of `public/`.

## Local runtime configuration

The developer's own values, such as a localhost API, live in `.mfe/runtime-config.json`. `generate`
adds any declared default the file lacks and never changes or removes a value already there, and
nothing that regenerates `.mfe/` touches it. `withMfe()` adds a middleware to Angular's dev server,
ahead of the compiled output, that answers `runtime-config.json` beside the container's assets with
that file, read on every request; so the generated `#mfe/config` fetches the same URL in development
and in production. `nx serve -c production` compiles in production mode and serves the declared
defaults instead, as a build ships them. No build copies `.mfe/`, so a production build ships only
the declared defaults, whatever the file holds and whatever it is named.

It is the one file in `.mfe/` that is committed: the project's `.gitignore` ignores `.mfe/*` and
adds `!.mfe/runtime-config.json`, and the `.mfe/.gitignore` the build writes, which takes
precedence inside `.mfe/`, makes the same exception. `withMfe({ runtimeConfigFileName })` renames
the file to `.mfe/<that name>`. The `generate` executor does not read `webpack.config.ts`, so it
neither seeds the renamed file nor excepts it in the `.mfe/.gitignore` it writes: create the file
yourself and commit it once with `git add -f`, after which git keeps tracking it.

A container generated before the file moved kept it in `public/`, which every build copies into its
output. `generate` moves it to `.mfe/` once, byte for byte, and says so. When both exist it leaves
both and warns that the `public/` copy is no longer read and would now ship: delete it.

## `withMfe()`

```ts
// webpack.config.ts
import { withMfe } from '@company/mfe-nx/webpack'

export default withMfe()
```

The builder calls the exported function with the configuration Angular built; `withMfe()` adds one
plugin and replaces nothing an author wrote. The container is the Nx project being built, or
`withMfe({ containerRoot })`; `withMfe({ shared })` adds share candidates. The plugin:

- plans the container from its sources and rewrites `.mfe/` before every compile;
- makes the generated stub the only entry (a polyfills or global-styles bundle is never loaded by a
  shell), and adds the `ModuleFederationPlugin` with the exposes and shares the plan derives
  (`remoteEntry.js`, `mf-manifest.json`);
- adapts what Angular configures for an application: `output.uniqueName` becomes the federation
  name, an empty `publicPath` becomes `auto`, chunks load as classic scripts rather than module
  scripts, the runtime stays in the remote entry (`runtimeChunk: false`), and top-level await is on
  for the generated configuration module;
- adds the `#mfe/*` aliases, and maps the `.js` specifiers the tsconfig's
  `rewriteRelativeImportExtensions` produces back to the `.ts` sources;
- sends the generated stylesheet through Angular's own global-style chain (extracted, loaded with
  each exposed entry) and through Tailwind and the `@scope` fallback first. Component styles are
  never touched: Angular encapsulates them. `src/styles.css` is imported into the generated
  stylesheet, so it is scoped too. PrimeNG's run-time styles are outside both, which is why every
  container pins one PrimeNG version and preset;
- reports the plan's diagnostics as compilation errors, emits `mfe-registry.json` and the other
  flat `.json` artifacts, ships the declared defaults as `runtime-config.json` in production, and
  stamps `mf-manifest.json` with `metaData.mfe` (`framework: 'angular'`) once federation has
  written it;
- in the dev server, answers `runtime-config.json` with the developer's `.mfe/runtime-config.json`
  (see [Local runtime configuration](#local-runtime-configuration)).

## Sharing

`src/federation/sharing.ts` holds the whole policy, in two groups that go in two share scopes:

- **Framework**, in the `angular@<installed @angular/core>` scope, such as `angular@19.2.25` —
  singleton and `strictVersion`: `@angular/core`, `@angular/common` (and the `@angular/common/`
  prefix, for `@angular/common/http`), `@angular/platform-browser`, `@angular/router`,
  `@angular/forms`, `@angular/animations`, `@angular/cdk` (and its prefix), `rxjs` (and its prefix)
  and `@company/mfe-angular`. Containers on the same Angular version share one copy; a container on
  another version brings its own set, so two Angular versions can share one page.
- **Page**, in `default` — singleton and `strictVersion`: `@company/mfe-core` and
  `@company/mfe-runtime`, one copy for the whole page whatever framework a container renders with.
- **Never shared**: `primeng`, `@primeng/themes`, `@primeuix/styled`, `@primeuix/utils`. Their theme
  engine keeps page-wide module state; `withMfe({ shared })` refuses them.

A package `withMfe({ shared })` adds joins the Angular scope as a singleton; an addition never
removes, relaxes or re-scopes a candidate. The registry entry lists the scopes as `shareScopes`
(`["default", "angular@19.2.25"]`), and the shell registers the container with exactly those.

A container shares a candidate it depends on. The page group is the exception: a React shell
provides the neutral packages but never the Angular adapter, so the first Angular container on a
page provides the adapter itself, and the adapter's own imports resolve in that container's build.
The build therefore shares the page singletons the installed adapter depends on, at the ranges the
adapter declares, although the container lists neither — otherwise every Angular mount would run
against a second copy of the core.

## Module format

Nx `require()`s generators and executors, and `@nx/angular:webpack-browser` / `:dev-server` load
`customWebpackConfig` with `require()` too, after registering a CommonJS TypeScript transpiler
(swc-node or ts-node), and await the function it exports. So the whole package builds to
**CommonJS**, `@company/mfe-nx/webpack` included, and every entry Nx or the builder loads is
`require()`-able.

`@company/mfe-build` is an ES module; this package reaches it with `require()`, which Node loads
natively from 20.19 and 22.12 (`require(esm)`, valid because its module graph has no top-level
await). `withMfe()` defers even that until the builder calls the function it returns: that
transpiler is still registered while the config file itself is being required, and it rewrites any
linked package the file loads — including `@company/mfe-build`'s ES modules, which it breaks. By
the time the function runs, the transpiler is unregistered.

`tsconfig.json` sets `module: "node20"`: each file's format follows its package (`"type":
"commonjs"` here, so this package compiles to CommonJS), `@company/mfe-build`'s ES modules
type-check with `import.meta`, `require()` of them is accepted, and a dynamic `import()` stays one.
`verbatimModuleSyntax` is off so the source keeps plain `import`/`export`, and
`rewriteRelativeImportExtensions` (from the repository's base config) keeps the repository's
convention of local imports carrying their extension. `tsconfig.build.json` sets `rootDir: "."` so
the emitted layout keeps the `src/` segment `generators.json` and `executors.json` point at, and
`scripts/copy-templates.mjs` copies the template folders and JSON schemas `tsc` does not emit.

## Version requirements

- **Angular 19.2.x**, zoneless only — the generated container never imports `zone.js` and has no
  polyfills. The builder is `@angular-devkit/build-angular` 19.2.27, the CLI release beside
  framework 19.2.25.
- **TypeScript 5.8.x** — Angular 19.2's compiler rejects 5.9 and later.
- **PrimeNG 19.1.4** with `@primeng/themes` 19.1.4 (its deprecation notice points to
  `@primeuix/themes`, which only PrimeNG 20 reads). Every Angular container on a page uses the same
  version and preset.
- **Nx 20–22** (see above), and **Node 20.19+ or 22.12+**.
- **`@nx/devkit`**: this package's `peerDependencies` declare `>=20.0.0 <23.0.0`, written literally
  rather than as a repository `catalog:` entry, because a consumer workspace's Nx version is
  unrelated to this repository's toolchain. The `catalog:` pins of `@nx/devkit`, `nx`, `webpack`,
  `css-loader` and `mini-css-extract-plugin` in this repository's `pnpm-workspace.yaml` are for this
  package's own tests, which compile a small container with real webpack.

## TypeScript-source dependencies

`@company/mfe-angular`, `@company/mfe-core`, `@company/mfe-runtime` and `@company/mfe-build`
currently publish TypeScript source. TypeScript never emits a `.ts` file it reached through
`node_modules` (it is an external library file), so the Angular compiler hands webpack an _empty_
module for each of them, and the build succeeds with a remote whose adapter does nothing. Until
they ship compiled output, a workspace consuming them has to add their sources to the container's
`tsconfig.app.json` and `tsconfig.spec.json` `include`.
