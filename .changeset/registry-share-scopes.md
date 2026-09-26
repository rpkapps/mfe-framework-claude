---
'@company/mfe-runtime': minor
---

A registry entry may carry `shareScopes`, the Module Federation share scopes its container's shares live in, such as `["default", "react@19.3.0"]`. `parseFederatedEntry` reads it, and the federation container loader registers the remote with it: `registerRemotes([{ name, entry, shareScope }])`. A remote links only the scopes named when it is registered, so a container on the host's framework version takes the host's copies and a container on another version keeps its own.

`default` is always registered, first, because the page-wide packages live there. An entry without `shareScopes`, from a container built before framework scopes, is registered with `default` alone, as before.

**Breaking:** `FederationRuntime.registerRemotes` receives `shareScope: string[]` on every remote. `@module-federation/runtime`'s own `registerRemotes` accepts it unchanged.
