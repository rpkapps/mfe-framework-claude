---
'@company/mfe-rspack': minor
---

`@company/mfe-rspack/federation` exports `hostShared({ root })`, the `shared` map for a federation host's `moduleFederation.options`, built from the same candidate list, sharing and eager rules and version rule `pluginMfe()` gives a container.

A host advertises the version it installed rather than the range it declared, and shares only what resolves; resolving none is a build error (§27).

It is exported as a subpath rather than from the package root, since a host runs none of `pluginMfe()`'s other work (§27).

Migration: a host's `rsbuild.config.ts` should call `hostShared({ root: <package.json directory> })` for `moduleFederation.options.shared` instead of resolving its own share scope.
