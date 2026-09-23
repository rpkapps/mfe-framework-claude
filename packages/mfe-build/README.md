# `@company/mfe-build`

The framework-neutral half of an MFE container build. It reads a container's
sources without running them, generates the `.mfe/` directory the container
imports and deploys, and derives what the bundler needs: the Module Federation
options, the share scope, the `#mfe/*` aliases and the stylesheet's PostCSS
chain. It knows no UI framework, router, bundler or design system; a build
integration supplies those.

Two integrations use it:

- `@company/mfe-rspack` builds React containers with Rsbuild and Rspack
  (`pluginMfe()`), and adds the React Compiler, TanStack Router's route tree
  and the design system's style root.
- `@company/mfe-nx` builds Angular containers with webpack through Nx.

A container never depends on this package directly. Its `src/mfe.config.ts`
imports `env` from its integration, which re-exports the helper from
`@company/mfe-build/env`.

## A profile, then `planContainer`

What differs between two integrations is stated once, as a `ContainerProfile`:

| Field                 | What it decides                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `generator`           | The package every generated banner names.                                                                                                     |
| `definitions`         | The modules `createApp` and `createWidget` may come from, and the examples a diagnostic suggests in the adapter's words.                      |
| `envModules`          | The modules `src/mfe.config.ts` may import `env` from; the first also types `#mfe/config`.                                                    |
| `adapterModule`       | Where the generated `#mfe/fetch` imports `createContainerTransport` from.                                                                     |
| `framework`           | Written into the registry entry and the manifest's `metaData.mfe`. Left out, neither carries one, which a host reads as React.                |
| `sharing`             | The share-scope candidates and how each is shared; a container shares one only when it depends on it, and an author can only add to the list. |
| `stylesheet`          | What Tailwind scans under `src/`, and any lines added after its imports.                                                                      |
| `exposeDefinition`    | Optional: how an exposed entry exports `definition`, in place of re-exporting the author's.                                                   |
| `generatedFiles`      | Optional: files only this integration generates. They count towards the build hash.                                                           |
| `readCapabilities`    | Optional: finds the App's capability routes. Without one, a container declares none.                                                          |
| `containerRootOption` | How an author points the integration at a container, for the repair when that is wrong.                                                       |

```ts
import { planContainer, writeGeneratedFiles } from '@company/mfe-build'

const plan = planContainer(profile, { containerRoot, buildTime })
writeGeneratedFiles(plan.generated.files) // skips every file whose bytes are unchanged
```

The plan carries everything the bundler glue needs: `exposes`, `shared`,
`aliases`, `entryStub`, `scopes`, `generated` (files, build hash, registry
descriptor and manifest metadata), and `diagnostics` to report as compilation
errors. Planning is synchronous and writes nothing, so a test needs no compiler.

## Building blocks

- `buildFederationOptions(plan)` and `withFrameworkMetadata(manifest, metadata)`,
  which stamps `metaData.mfe` into the emitted `mf-manifest.json`.
- `containerPostcssPlugins({ scopes, containerRoot, loadScopePlugin, configured })`:
  Tailwind, then the scope plugin the integration loads. A design system's own
  plugin takes the same `ScopeOptions`; `scopeFallbackPlugin` is the built-in
  one, which confines every rule with CSS `@scope` and renames the keyframes it
  defines, for an integration that has no design-system plugin to use.
- `collectCapabilities(markers, owner, terms)`: the capability contract's rules
  (a known name, a label, an icon that is a name or `{ src }`, one route per
  capability, Apps only), for a reader that has found the markers in its
  router's own syntax.
- `seedLocalRuntimeConfig(plan)` and `RUNTIME_CONFIG_DEFAULTS_FILE`, for a
  standalone generate command and for shipping the declared defaults.
- The syntax helpers (`parseSourceFile`, `collectImportedBindings`, `walk`, …),
  the generated-file helpers (`banner`, `joinBlocks`, `quote`,
  `relativeSpecifier`, `generatedPath`) and `createBuildError`, so an
  integration's own discovery and generated files read like these.

`@company/mfe-build/federation` exports the share-scope machinery,
`installedVersionFrom`, the federation options and `createBuildError` without
loading the TypeScript compiler, so a host's build config can resolve its share
scope cheaply.
