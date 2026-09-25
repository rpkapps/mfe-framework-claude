---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-build': minor
'@company/mfe-rspack': minor
'@company/mfe-nx': minor
'@company/mfe-devtools': minor
'@company/mfe-legacy-angular': minor
---

An App's build publishes its routes (§48). A registry entry gains `routes: [{ path, search? }]`, App-only: every route the build can read, with paths in one syntax for every router (`:name`, `:name?`, `*`) and, for TanStack Router, the JSON Schema of the search params each route reads, its parents' included. `ContainerProfile` gains `readRoutes`; the React and Angular integrations implement it. The React integration reads TanStack Router's `$id` and `{$id}` as `:id`, `{-$id}` as `:id?` and `$` and `{$}` as `*`, publishes the index route inside a pathless layout or a group, skips the route files the router's generator skips (a `-` prefix, `*.test.*` and `*.spec.*`), and leaves out a route whose parameter shares its segment with a prefix or a suffix. The Angular integration leaves out redirects, `**`, routes with a `matcher` and routes on a named outlet. The developer tools list an entry's route paths. **Breaking:** the legacy adapter's `LegacyRegistryEntry.routes` is `legacyRoutes`.
