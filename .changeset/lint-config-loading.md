---
'@company/eslint-plugin-mfe': minor
'@company/create-mfe': patch
---

An ESLint configuration that loads on any supported Node, and a preset for the build and test configuration files nothing was linting.

- Write the flat config as `eslint.config.ts`, not `eslint.config.mjs`. This package's entry is TypeScript, so a `.mjs` config reached it as an untransformed `.ts` import that only a Node with type stripping could read: an editor running ESLint on its own bundled Node reported a configuration error on every file instead of a lint result. A `.ts` config goes through jiti, which transforms the config and everything it imports. Install `jiti` alongside ESLint.
- New `mfe.tooling(options)` preset, also as `mfe.configs.tooling`, for the files named after the tool that reads them — `eslint.config`, `rsbuild.config`, `vite.config`, `vitest.config` and `vitest.setup`, exported as `mfe.DEFAULT_TOOLING_FILES`. It layers the recommended baselines and the async, type-safety and maintainability rules, and leaves out the MFE rules and package zones, which have nothing to say about a build configuration. In a setup file `no-empty-object-type` allows a single-`extends` interface, because that is the only shape a matcher augmentation can take.
- The scaffold writes `eslint.config.ts` composing `mfe.author(...)` and `mfe.tooling(...)`, so a new container lints its own rsbuild, vitest and setup files.
