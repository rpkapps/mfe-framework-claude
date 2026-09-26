---
'@company/mfe-build': minor
'@company/mfe-rspack': minor
'@company/mfe-nx': minor
'@company/mfe-core': minor
---

Every framework shares in a Module Federation share scope of its own, named after the exact version installed: `react@19.3.0`, `angular@19.2.25`. Containers on the same framework version whose ranges agree still download one copy, while a container on another version brings its own complete set and several React or Angular versions can share one page. `@company/mfe-core` and `@company/mfe-runtime` stay shared in `default`. Nothing is shared as a singleton, inside a scope or in `default` (see the entry on sharing nothing as a singleton).

**`@company/mfe-build`**

- **Breaking:** `SharingPolicy.frameworkScoped` is required. `SINGLETON` is framework-scoped; the new `PAGE_SINGLETON` is not. Later in this release they are `FRAMEWORK_SCOPED` and `PAGE_WIDE`, and neither makes a singleton. `resolveShared` takes a `frameworkScope` and every `SharedModuleConfig` it returns carries `shareScope`.
- **Breaking:** `ContainerProfile.framework` is required and `ContainerProfile.frameworkAnchor` is new. The plan names the framework scope after the installed version of the anchor, and fails with a build error naming the anchor when it is not installed.
- The plan also shares the page-wide candidates the container's adapter depends on, at the versions installed beside the adapter; `adapterCarriedShares`, `adapterDependencies`, `resolveFrameworkScope`, `frameworkShareScope`, `shareScopesOf` and `PAGE_SHARE_SCOPE` are exported from `/federation`. Later in this release `adapterCarriedShares` and `frameworkShareScope` stopped being exported, since nothing outside the package imports them (see the entry on planning a container once).
- An author's `shared` override joins the framework scope, or restates an existing candidate's range in the scope it already has; it never moves one to another scope.
- The registry descriptor always carries `framework` and a new `shareScopes` list (`default` first); the manifest metadata always carries `framework`.
- `installedVersionFrom` walks the `node_modules` directories above the root instead of calling `require`, so a package that only `NODE_PATH` holds, as pnpm's binary shims set it, is never shared.
- The `typescript` peer accepts `>=5.5.0 <7.0.0`, so an Angular workspace on TypeScript 5.8 can install it. Every compiler API the discovery uses exists in 5.5, and the package's tests pass against 5.5.4.

**`@company/mfe-rspack`**

- React, `react-dom`, `sonner`, both TanStack packages and the design system's other entries (`react-aria-components`, `recharts`, with the design system's own `eager` flag) are shared in `react@<installed react>`. `@company/mfe-react` and `@tecton/react/` were shared there too until later in this release (see the entries on sharing nothing as a singleton and on sharing React's entry points).
- A React container's registry entry and manifest now say `framework: "react"`.
- `hostShared` scopes every React-bound candidate by the React the host installed, and reads `@company/mfe-core` and `@company/mfe-runtime` beside `@company/mfe-react`, where the adapter's own imports resolve, rather than through `NODE_PATH`. `hostFederation` keeps `shareStrategy: 'loaded-first'`.

**`@company/mfe-nx`**

- The Angular group (`@angular/*`, `@angular/cdk`, `rxjs`) is shared in `angular@<installed @angular/core>`; the neutral packages stay in `default` and PrimeNG stays unshared. `@company/mfe-angular` was shared there too until later in this release (see the entry on sharing nothing as a singleton). The adapter-carried page-wide packages are now planned by `@company/mfe-build`, so `adapterCarriedShares` is no longer exported here.

**`@company/mfe-core`**

- `ContainerDescriptor.shareScopes` is new: the scopes a host registers the container with. A descriptor without it shares in `default` alone. Later in this release it is required (see the entry on builds from before a field existed).
