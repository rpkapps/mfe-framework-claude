---
'@company/create-mfe': patch
'@company/mfe-rspack': patch
'@company/mfe-react': patch
'@company/mfe-devtools': patch
'@company/mfe-legacy-angular': patch
---

These packages publish compiled JavaScript and declarations. Their `exports` and `bin` named TypeScript source, which Node refuses to run from `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so `pnpm create @company/mfe`, `mfe-generate` and an `rsbuild.config.ts` importing `pluginMfe()` failed as soon as they were installed.

- Each entry resolves to `dist/` (`types` to its `.d.ts`, `default` to its `.js`), and each bin to a small file in `bin/` that runs its compiled `.js`. A bin cannot name `dist/` itself: a package manager links a bin only when its file exists at install, and a workspace builds `dist/` after installing. The source is still published, and named under the `mfe-source` condition this repository resolves with.
- A pack refuses a `dist/` that is missing or older than the source, as the other framework packages' already does. `@company/create-mfe` no longer lists a `templates` directory that never existed, and `@company/mfe-devtools` now emits the declarations its `types` point at.
- `create-mfe` and `mfe-generate` run when started through a symlink, which is how a package manager installs a bin: the file in `bin/` calls the compiled CLI's `main` itself, and the compiled CLI, started directly, compares the real path of the started file with its own module URL, not the file name's ending.
