---
'@company/eslint-plugin-mfe': patch
'@company/mfe-agent': patch
'@company/mfe-angular': patch
'@company/mfe-build': patch
'@company/mfe-core': patch
'@company/mfe-devtools': patch
'@company/mfe-legacy-angular': patch
'@company/mfe-react': patch
'@company/mfe-rspack': minor
'@company/mfe-runtime': patch
---

Peer dependencies are ranges of what the framework supports, not the exact versions this repository installs. A `catalog:` peer is published as the catalog's exact version, so `react: 19.3.0` or `zod: 4.6.5` made every consumer on another patch release see an unmet peer.

- `zod` `^4.2.0`: the runtime describes an action's schemas with the schema's own `toJSONSchema()`, which Zod added in 4.2.
- `react` and `react-dom` `^19.0.0`; `@tanstack/react-query` `^5.0.0`; `@tanstack/react-router` `^1.170.0`, the line the boundary history and the blocker delegation are proven against.
- `@angular/common`, `@angular/core`, `@angular/platform-browser` and `@angular/router` `^19.2.0`, the zoneless Angular 19 the adapter targets; `rxjs` `^7.4.0`, as Angular 19 itself asks.
- `@rsbuild/core` and `@rspack/core` `^2.2.0`, and `typescript` `>=5.5.0 <7.0.0`, the range `@company/mfe-build` already declares for the discovery it runs.
- `eslint` `^9.18.0 || ^10.0.0`, the releases that load an `eslint.config.ts`; `eslint-plugin-react-hooks` `^7.1.0`, `@tanstack/eslint-plugin-query` `^5.103.0` and `@tanstack/eslint-plugin-router` `^1.162.0`, whose rules and flat configs the presets name.

**Breaking for `@company/mfe-rspack`:** `@tecton/react` is a required peer. `pluginMfe()` imports the design system's federation share list when it is loaded, and a container stylesheet cannot be scoped without its PostCSS plugin, so a container without it never built.
