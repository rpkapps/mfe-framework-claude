---
'@company/create-mfe': patch
'@company/eslint-plugin-mfe': patch
'@company/mfe-agent': patch
'@company/mfe-angular': patch
'@company/mfe-build': patch
'@company/mfe-core': patch
'@company/mfe-devtools': patch
'@company/mfe-legacy-angular': patch
'@company/mfe-nx': patch
'@company/mfe-react': patch
'@company/mfe-rspack': patch
'@company/mfe-runtime': patch
---

Every package declares the Node versions it runs on, so a package manager warns at install instead of a build failing on its first `require()` or unsupported syntax.

- `"engines": { "node": "^20.19.0 || >=22.12.0" }`: the releases that `require()` an ES module, which `@company/mfe-nx` does to load `@company/mfe-build`.
- `@company/eslint-plugin-mfe`: `^20.19.0 || ^22.13.0 || >=24`, what ESLint 10 and the parser it installs require.
- `@company/mfe-rspack`: `^22.18.0 || >=24.11.0`, what Babel 8, which runs the React Compiler, requires.
