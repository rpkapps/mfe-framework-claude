---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
---

The runtime is named for what it is, carries the deadlines every mount runs under, and lets an adapter wrap the loads of its own containers.

**`@company/mfe-core`**

- `MfeAdapter` gains an optional `aroundLoad(load, entry)`. The runtime runs each load inside the hook of the adapter that parsed the entry, once per load that actually happens rather than once per caller waiting on it.

**`@company/mfe-runtime`**

- **Breaking:** `createHostRuntime` is now `createMfeRuntime`, `CreateHostRuntimeOptions` is now `CreateMfeRuntimeOptions`, `HostRuntimeHandle` is now `MfeRuntimeHandle` and `MfeHostRuntime` is now `MfeRuntime`. `adapters` stays required: the shell lists every adapter, and nothing is registered implicitly.
- `createMfeRuntime({ deadlines })` takes a `Partial<DeadlineConfig>`, merged over `DEFAULT_DEADLINES`, and `MfeRuntime.deadlines` carries the result.
- **Breaking:** `/testing`'s `createMemoryHostRuntime` is now `createMemoryRuntime`, with `MemoryRuntime` and `MemoryRuntimeOptions`. It also takes `adapters`, `registryEntries`, read through `readRegistry` as a shell reads them, and `deadlines`.
- **Breaking:** `createFederationContainerLoader` no longer takes `aroundLoad`. An adapter declares the hook itself.

**`@company/mfe-react`**

- `reactAdapter.aroundLoad` hides TanStack Router's development global while a React container evaluates. `createMf2ContainerLoader` no longer applies it, so it is never applied twice, and it now runs for React containers only.

**`@company/mfe-angular`**

- `createMfeRuntime` returns `MfeRuntimeHandle`. The root re-exports `MfeRuntimeHandle` and `MfeRuntime` in place of `HostRuntimeHandle` and `MfeHostRuntime`.
