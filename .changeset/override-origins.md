---
'@company/mfe-runtime': minor
---

Developer overrides still work in deployed builds, but now only point at loopback by default: `localhost`, `127.0.0.1` or `[::1]`, on any port, over http or https. An override on any other origin is not applied and is reported as a warning that names the origin and how to allow it, through the new `overrideOrigins` option of `createMfeRuntime` (and `allowedOrigins` of `readDevOverrides`), which lists further origins as `URL.origin` prints them. Before, anything that could write `localStorage["company:mfe:overrides"]` could point a definition at a manifest on any host.

An override for an id the registry does not list is now reported too, rather than changing nothing without a word. And when a different user signs in to a tab than the one its session record was written for, the overrides left in it are not applied and are removed, with a warning; `overrideStorage` accepts an optional `removeItem` for that, and the shell passes the whole of `localStorage`. `recordSessionIdentity(store, identity)` returns `{ previousIdentity }` so a host that assembles its own runtime can do the same with `discardDevOverrides`.
