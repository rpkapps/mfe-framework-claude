---
'@company/mfe-nx': patch
---

A generated container's `lint` target now runs in a fresh Nx workspace. Its `tsconfig.json` includes `eslint.config.ts` and `webpack.config.ts`, which the generated lint config checks with type information and which ESLint otherwise reported as a parsing error. The container also lists `jiti` among its devDependencies, because ESLint loads a TypeScript config only through it and never installs it itself.
