---
'@company/mfe-runtime': minor
---

The runtime's mount internals are simpler, and a few leftovers of the earlier two-path mounting are gone.

- **Breaking:** `CreateMountContextOptions.scopeRoot` is gone. `createMountContext` always creates the mount's scope root, detached and stamped with its scope attributes, and `mountDefinition` places it and removes it; a host that wants the element reads `context.scopeRoot`.
- A mounted Widget no longer keeps the first input set it was given alive for its whole life; a `consumerEvents` getter a host passes is still read when each event arrives.
- A memory runtime from `@company/mfe-runtime/testing` is wired by the same code as `createMfeRuntime`, and its `dispose()` now also drops the navigator's blockers, as the production runtime's does.
