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

| Field                 | What it decides                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `generator`           | The package every generated banner names.                                                                                                 |
| `definitions`         | The modules `createApp` and `createWidget` may come from, and the examples a diagnostic suggests in the adapter's words.                  |
| `envModules`          | The modules `src/mfe.config.ts` may import `env` from; the first also types `#mfe/config`.                                                |
| `adapterModule`       | Where the generated `#mfe/fetch` imports `createContainerTransport` from.                                                                 |
| `framework`           | Written into the registry entry and the manifest's `metaData.mfe`, and the name the framework's share scope starts with.                  |
| `frameworkAnchor`     | The package whose installed version names the framework's share scope: `react` gives `react@19.3.0`.                                      |
| `sharing`             | The framework's share-scope candidates and how each is shared; the build adds the page-wide ones, and an author can only add to the list. |
| `stylesheet`          | What Tailwind scans under `src/`, any lines added after its imports, and a query the entries import the stylesheet with.                  |
| `exposeDefinition`    | Optional: how an exposed entry exports `definition`, in place of re-exporting the author's.                                               |
| `generatedFiles`      | Optional: files only this integration generates. They count towards the build hash.                                                       |
| `readCapabilities`    | Optional: finds the App's capability routes. Without one, a container declares none.                                                      |
| `containerRootOption` | How an author points the integration at a container, for the repair when that is wrong.                                                   |

```ts
import { planContainer, writeGeneratedFiles } from '@company/mfe-build'

const plan = planContainer(profile, { containerRoot, buildTime })
writeGeneratedFiles(plan.generated.files) // skips every file whose bytes are unchanged
```

A plan lists its own files in `.mfe/.generated-files.json`, and writing a list that
changed deletes each file the one before named and this one does not, so a removed
Widget's entry and contract, or `config.ts` once `src/mfe.config.ts` is gone, go
with it. A file no plan listed is never deleted, the developer's
`.mfe/runtime-config.json` included.

The plan carries everything the bundler glue needs: `exposes`, `shared`,
`aliases`, `entryStub`, `stylesheet`, `scopes`, `generated` (files, build hash,
registry descriptor and manifest metadata), and `diagnostics` to report as
compilation errors. Planning is synchronous and writes nothing, so a test needs
no compiler.

A watching build keeps one planner: `createContainerPlanner(profile, options)`
returns a function that plans on every call. It reads the manifest and resolves
the shares on its first call only, because they cannot change without a
restart, reads each source once per plan and parses only the files whose text
changed since the call before.

## Building blocks

- `applyContainerCompilation(compiler, options)`: what a webpack or Rspack
  plugin does to each compilation, written against the hooks both share. It
  writes the configured plan, re-plans before every compile after the first,
  reports the plan's diagnostics, ships each generated file that names an
  `asset`, and stamps `metaData.mfe` into the emitted `mf-manifest.json`. The
  declared defaults ship as the runtime configuration of a production compile
  and of no other. The plugin chooses the error type and the repair for a
  missing manifest.
- `buildFederationOptions(plan)` and `withFrameworkMetadata(manifest, metadata)`,
  which stamps `metaData.mfe` into the emitted `mf-manifest.json`.
- `containerPostcssPlugins({ scopes, containerRoot, loadScopePlugin, configured })`:
  Tailwind, then the scope plugin the integration loads. A design system's own
  plugin takes the same `ScopeOptions`; `scopeFallbackPlugin` is the built-in
  one, which confines every rule with CSS `@scope` and renames the keyframes it
  defines, for an integration that has no design-system plugin to use.
- `collectCapabilities(markers, owner, terms)`: the capability contract's rules
  (an inline `{ name, label, icon? }` object, a known name, a label, an icon
  that is a name or `{ src }`, one route per capability, Apps only), for a
  reader that has found the `capability` properties in its router's own syntax.
- `seedLocalRuntimeConfig(plan)` and `summarizeGeneration(plan, written, local)`,
  for a standalone generate command and what it reports. The developer's own
  values live in `.mfe/runtime-config.json` (`localRuntimeConfigPath(options)`),
  inside the build-managed directory, which no bundler copies into a build's
  output. Seeding only adds the declared defaults the file lacks, and moves a
  copy an earlier version left in `public/` there once.
- `serveLocalRuntimeConfig({ containerRoot, generatedDir, runtimeConfigFileName, servePath })`:
  a Connect-style middleware for either dev server that answers the runtime
  configuration's URL with that file, read on every request, so container code
  fetches the same URL in development and in production.
- The syntax helpers (`parseSourceFile`, `importedLocals`, `callsTo`,
  `resolveRelativeModule`, `findExportedExpression`, `walk`, …), the
  generated-file helpers (`banner`, `joinBlocks`, `quote`, `relativeSpecifier`,
  `generatedPath`, `stylesheetPath`) and `createBuildError`, so an integration's
  own discovery and generated files read like these. A capability reader is
  handed the plan's `sources`, which read and parse each file once.
- `@company/mfe-build/testing`: the container fixture the integrations' tests
  share, which writes a container into a temporary directory from the manifest
  and installed packages the integration names.

## Share scopes

Every candidate is either framework-scoped (`FRAMEWORK_SCOPED`) or page-wide
(`PAGE_WIDE`). A framework-scoped candidate goes in the share scope named after the
exact framework version the container installed, such as `react@19.3.0` or
`angular@19.2.25`, so a container on another version brings its own complete set.
A page-wide candidate goes in `default`, which every container on the page shares
whatever its framework.

Nothing is a singleton, because containers are released from repositories of their
own: every entry is `singleton: false, strictVersion: false`, and a policy has no
field that could make it one. A container gets the loaded copy that satisfies its
range, so containers whose ranges agree load one copy, and one that nothing loaded
satisfies uses its own copy instead of failing to load.

The build adds the page-wide candidates, `@company/mfe-core` and `@company/mfe-runtime`
(`PAGE_POLICY`), to every profile's candidates itself (`withPagePolicy`), so an
integration cannot forget them. A container depends on its adapter, not on the
neutral packages the adapter imports, so the page-wide candidates the adapter
itself depends on are shared at the versions installed beside the adapter. A
container's own entry for one wins.

An author's `shared` override adds a candidate to the framework scope, or restates
the range of an existing one. It never removes a candidate or moves it to another
scope. The registry descriptor lists the scopes as
`shareScopes`, `default` first, and a host registers the container with them.

Installed versions are read by walking the `node_modules` directories above a
root, never through `require`, so a package that only `NODE_PATH` holds is never
shared.

`@company/mfe-build/federation` exports the share-scope machinery,
`installedVersionFrom`, the federation options and `createBuildError` without
loading the TypeScript compiler, so a host's build config can resolve its share
scope cheaply.
