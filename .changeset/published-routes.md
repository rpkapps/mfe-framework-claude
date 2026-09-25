---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-build': minor
'@company/mfe-rspack': minor
'@company/mfe-nx': minor
'@company/mfe-devtools': minor
'@company/mfe-legacy-angular': minor
---

An App's build publishes its routes (§48). A registry entry gains `routes: [{ path, search? }]`, App-only: every route the build can read, with paths in one syntax for every router (`:name`, `:name?`, `*`) and, for TanStack Router, the JSON Schema of the search params each route reads, its parents' included. `ContainerProfile` gains `readRoutes`; the React and Angular integrations implement it. The developer tools list an entry's route paths. **Breaking:** the legacy adapter's `LegacyRegistryEntry.routes` is `legacyRoutes`.
