---
'@company/mfe-build': minor
'@company/mfe-rspack': patch
'@company/mfe-nx': minor
---

A container is planned once per process and each of its sources is parsed at most once per plan, and both bundler plugins run each compilation through one helper. Generated output is unchanged for a React container.

**`@company/mfe-build`**

- `createContainerPlanner(profile, options)` returns a function that plans the container on every call. It reads the manifest and resolves the shares on its first call only, reads each source once per plan, and parses only the files whose text changed since the previous call. `planContainer` is one call of a fresh planner.
- **Breaking:** `PlanContainerOptions` and its `defaultRoot` are gone. Pass `containerRoot`, which defaults to the working directory.
- **Breaking:** `CapabilityContext.sources` is required: the plan's `ContainerSources`, which read and parse each file once for the whole plan. A profile's `readCapabilities` receives it; only code that builds a context itself has to supply one.
- `applyContainerCompilation(compiler, options)` is what a webpack or Rspack plugin does to each compilation, typed against the hooks both share: it writes the configured plan, re-plans before every compile after the first, reports the plan's diagnostics, ships every generated file that names an `asset`, and stamps `metaData.mfe` into the federation manifest. `GeneratedFile.asset` is new.
- `ContainerPlan.stylesheet` is the generated stylesheet's path and `stylesheetPath(context)` is exported. `StylesheetProfile.query` is appended to the request every exposed entry imports the stylesheet with, and declared in the generated `css.d.ts`.
- `PAGE_POLICY` and `withPagePolicy(policy)` are exported. The build adds the page singletons to every profile's `sharing` itself, so a profile lists only its framework's candidates. `adapterDependencies(…).installedVersion` answers only for a name the adapter declares.
- `summarizeGeneration(plan, written, local)` builds a generate command's report. `resolveRelativeModule`, `findExportedExpression`, `importedLocals` and `callsTo` are exported for an integration's own discovery.
- `@company/mfe-build/testing` exports the container fixture the integrations' tests share.
- **Breaking:** no longer exported, since nothing outside the package imports them: `listNames`, `jsonFile`, `frameworkShareScope` and `RUNTIME_CONFIG_DEFAULTS_FILE` from the root, and `adapterCarriedShares`, `pagePolicy`, `containerDependencies`, `frameworkShareScope`, `isUsableVersionRange` and `sortedByName` from `/federation`.
- The icon reader keeps an index of each module it reads instead of its syntax tree, and reads an icon module again when its size or modification time changes, so a watching build sees an edited icon.

**`@company/mfe-rspack`**

- `pluginMfe()` plans the container once for the Rsbuild config and the Rspack plugin together, instead of three times before the first compile, and `mfe-generate` reports through `summarizeGeneration`.

**`@company/mfe-nx`**

- A generated Angular container's exposed entries import `../styles.css?ngGlobalStyle` directly, and its `.mfe/css.d.ts` declares that request; the plugin no longer rewrites the request while resolving modules.
- `withMfe()` plans the container once at start-up and not again before the first compile, and the `generate` executor reports through `summarizeGeneration`.
