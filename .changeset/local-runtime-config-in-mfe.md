---
'@company/mfe-build': minor
'@company/mfe-rspack': minor
'@company/mfe-nx': minor
'@company/create-mfe': minor
---

A container's local runtime configuration moves from `public/runtime-config.json` to `.mfe/runtime-config.json` (`.mfe/<runtimeConfigFileName>` when renamed). Both bundlers copy `public/` into a build's output and neither copies `.mfe/`, so the developer's values, such as a localhost API, can no longer ship, whatever the file is named. Container code is unchanged: it fetches the same `runtime-config.json` URL.

- The dev servers answer `runtime-config.json` with the local file, read on every request: `pluginMfe()` registers the middleware ahead of Rsbuild's own, and `withMfe()` places it before the compiled output in Angular's dev server. A copy left in `public/` is never the one served. A production-mode Angular dev server (`nx serve -c production`) still serves the declared defaults, as before.
- A production build ships only the declared defaults. The webpack overwrite of a copied `runtime-config.json`, the Rsbuild public-directory skip and the Nx generator's production-assets `ignore` are gone.
- `mfe-generate` and the `@company/mfe-nx:generate` executor seed `.mfe/runtime-config.json` with the declared defaults, as they seeded `public/runtime-config.json`: they only add missing keys. Upgrading, the first run moves an existing `public/runtime-config.json` to `.mfe/` byte for byte and says so; when both exist it leaves both and warns that the `public/` copy is no longer read and can now ship in production in place of the declared defaults.
- The generated `.mfe/.gitignore` excepts the local file under its configured name. Generated containers ignore `.mfe/*` with `!.mfe/runtime-config.json` instead of `.mfe/`, so the values stay committed; an existing container's `.gitignore` needs the same change.

**`@company/mfe-build`**

- `serveLocalRuntimeConfig({ containerRoot, generatedDir, runtimeConfigFileName, servePath })` is the dev-server middleware, and `localRuntimeConfigPath(options)` locates the file.
- `LocalRuntimeConfig` reports `movedFrom` and `leftInPublic`, and `summarizeGeneration` turns them into notes.
- **Breaking:** `ContainerCompilationOptions.copiedRuntimeConfig` is gone. A production compile ships the declared defaults unless the bundler already emitted an asset of that name, like every other generated asset.
