# @company/mfe-nx

Nx generators that scaffold a zoneless Angular 19 MFE container — an `app` (routable) or a
`widget` (non-routable) — built with `@company/mfe-angular` and wired to Rspack through
`@company/mfe-rspack/rspack`.

This package is consumed from a **separate Nx workspace**, not from this repository (this
repository is a plain pnpm workspace and is not, and must not become, an Nx workspace).

## Installing in an Nx workspace

```sh
npm install --save-dev @company/mfe-nx
```

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
| `skipPackageJson` | `false`                        | Do not add the container's dependencies to the workspace `package.json` (its own manifest still lists them).                      |

## What gets generated

```
apps/my-app/
  project.json            # nx:run-commands targets: generate, build, serve, test, typecheck
  package.json             # this container's own manifest: mfe.port, mfe.definitions, scripts, deps
  rspack.config.ts         # createConfig() from @nx/angular-rspack, composed with withMfe()
  src/
    main.ts                 # bootstraps nothing — the shell mounts the definition
    index.html               # for `rspack serve` only; a remote is fetched, never browsed to
    styles.css               # @import 'tailwindcss'; global styles only (Angular inlines the rest)
    mfe.ts                    # createApp({ id, version, routes })
    mfe.config.ts             # the config schema; values live in public/runtime-config.json
    app.routes.ts              # '' and 'settings' (a capability route, via mfeRouteData)
    overview.component.ts       # standalone, OnPush, injectUser()
    overview.component.spec.ts   # @company/mfe-angular/testing's mountApp
    settings.component.ts
  public/runtime-config.json
  tsconfig.json / tsconfig.app.json / tsconfig.spec.json
  vitest.config.mts           # @analogjs/vite-plugin-angular, JIT
  vitest.setup.ts              # import '@angular/compiler' — no zone.js
  .gitignore
  README.md
```

A `widget` project omits the routing, config and `public/` files and instead has
`src/mfe.ts` (`createWidget({ id, version, inputs, events, component })`, exporting the contract
separately) and `src/<id>.component.ts` (signal `input()`/`output()`), with its `package.json`
publishing `exports['./contracts']`.

Every target runs `mfe-generate` (from `@company/mfe-rspack`) first: the build's `.mfe/*` modules
have to exist before `rspack`, `vitest` or `tsc` can resolve them.

## Pointing the shell at it

```js
const key = 'company:mfe:overrides'
const overrides = JSON.parse(localStorage.getItem(key) || '{}')
overrides['<id>'] = 'http://localhost:<port>/mf-manifest.json'
localStorage.setItem(key, JSON.stringify(overrides))
location.reload()
```

## Version requirements

- **Angular 19.2.x**, zoneless only — the generated container never imports `zone.js` and always
  provides `provideExperimentalZonelessChangeDetection()`.
- **TypeScript 5.8.x** — Angular 19's compiler rejects TypeScript 5.9+, so the generated project
  is pinned there regardless of what this Nx workspace's own root TypeScript is.
- **Nx 20–22** — `@nx/angular-rspack` ships a line per Nx major that still supports Angular 19
  (20.6–20.9, 21.x, 22.x; 23.x requires Angular 20+). This generator reads the workspace's
  installed `nx` version and picks the matching `@nx/angular-rspack` line (20 → `20.9.0`,
  21 → `21.6.5`, 22 → `22.7.12`); an unrecognized major falls back to the Nx 22 line and logs why.
- **`@nx/devkit`**: this package's `peerDependencies` declare `>=20.0.0 <24.0.0`, written
  literally rather than as a repository `catalog:` entry, because `@nx/devkit`'s own supported
  `nx` range differs by major and a consumer workspace's Nx version is unrelated to this
  repository's own toolchain. The `catalog:` pin of `@nx/devkit`/`nx` in this repository's
  `pnpm-workspace.yaml` is only for this package's own tests and typecheck.

## Targets: `nx:run-commands` over the Rspack CLI

`build`, `serve`, `test`, `typecheck` and `generate` are plain `nx:run-commands` targets running
`rspack build` / `rspack serve` / `vitest run` / `tsc --noEmit` / `mfe-generate` directly, rather
than an `@nx/rspack:rspack` / `@nx/rspack:dev-server` executor. `@nx/angular-rspack`'s
`createConfig` is a plain configuration function, not an executor, and ships no Nx executor of its
own; `nx:run-commands` keeps this generator's own version compatibility independent of
`@nx/rspack`'s. If a workspace prefers the executor-based idiom, `@nx/rspack:rspack` (build) and
`@nx/rspack:dev-server` (serve) both accept the generated `rspack.config.ts` as their
`main`/`config` — swap the two `build`/`serve` target definitions in `project.json` after
generation; `test`, `typecheck` and `generate` stay as `nx:run-commands` either way, since there is
no dedicated Nx executor for either.

## Lint config

The generated project does not include an `eslint.config.ts`: `@company/eslint-plugin-mfe`'s
`author()` preset applies `@tanstack/eslint-plugin-query` and `@tanstack/eslint-plugin-router`
unconditionally (there is no option to omit them today), and neither plugin belongs in an Angular
container. Generate a workspace-appropriate `eslint.config.mjs` by hand, or wait for `author()` to
gain a `router: false` / `query: false` option (tracked as follow-up work on
`@company/eslint-plugin-mfe`).

## CommonJS build

Nx loads generator factories with a synchronous `require()`, so this package builds to CommonJS —
the one package in this repository that does not build to ESM. Its `tsconfig.json` sets
`"module": "commonjs"` and `"verbatimModuleSyntax": false`: `verbatimModuleSyntax` requires
`export =` / `import ... = require()` syntax once a file's effective module kind is CommonJS
(TypeScript 6.0.3 raises `TS1287` for a top-level `export const` otherwise), which would make this
package's source look unlike every other package's plain `import`/`export`. `module: "commonjs"`
is independent of Node's own per-file module-kind detection (unlike `module: "node16"` /
`"nodenext"`, which reject `TS1287` the same way once a file resolves as CommonJS), so ordinary
`import`/`export` syntax keeps working and only the _emitted_ format changes.
`allowImportingTsExtensions` and `rewriteRelativeImportExtensions` (inherited from the repository's
base config) still rewrite a local `./foo.ts` import to `./foo.js` on emit, so this package's
source keeps the repository's usual convention of local imports carrying their extension.
`tsconfig.build.json` sets `rootDir: "."` (rather than the `"src"` every other package in this
repository uses) so the emitted layout keeps the `src/` segment: `generators.json`'s factories
point at `./dist/src/generators/app/generator#default` and
`./dist/src/generators/widget/generator#default`. `scripts/copy-templates.mjs` copies the
generator template folders and `schema.json` files — neither of which `tsc` emits — into `dist`
alongside the compiled generators after the build, so `path.join(__dirname, 'files')` resolves
correctly from both `src` (under Vitest) and `dist` (under Nx).
