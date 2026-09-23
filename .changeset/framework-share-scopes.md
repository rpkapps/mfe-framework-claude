---
'@company/mfe-build': minor
'@company/mfe-rspack': minor
'@company/mfe-nx': minor
'@company/mfe-core': minor
---

Every framework shares in a Module Federation share scope of its own, named after the exact version installed: `react@19.3.0`, `angular@19.2.25`. Inside a scope the rule is unchanged, one strict singleton per candidate, so containers on the same framework version still download one copy, while a container on another version brings its own complete set and several React or Angular versions can share one page. `@company/mfe-core` and `@company/mfe-runtime` stay page singletons in `default`.

**`@company/mfe-build`**

- **Breaking:** `SharingPolicy.frameworkScoped` is required. `SINGLETON` is framework-scoped; the new `PAGE_SINGLETON` is not. `resolveShared` takes a `frameworkScope` and every `SharedModuleConfig` it returns carries `shareScope`.
- **Breaking:** `ContainerProfile.framework` is required and `ContainerProfile.frameworkAnchor` is new. The plan names the framework scope after the installed version of the anchor, and fails with a build error naming the anchor when it is not installed.
- The plan also shares the page-wide candidates the container's adapter depends on, at the versions installed beside the adapter; `adapterCarriedShares`, `adapterDependencies`, `resolveFrameworkScope`, `frameworkShareScope`, `shareScopesOf` and `PAGE_SHARE_SCOPE` are exported from `/federation`. Later in this release `adapterCarriedShares` and `frameworkShareScope` stopped being exported, since nothing outside the package imports them (see the entry on planning a container once).
- An author's `shared` override joins the framework scope as a singleton, or tightens an existing candidate in the scope it already has; it never moves one to another scope.
- The registry descriptor always carries `framework` and a new `shareScopes` list (`default` first); the manifest metadata always carries `framework`.
- `installedVersionFrom` walks the `node_modules` directories above the root instead of calling `require`, so a package that only `NODE_PATH` holds, as pnpm's binary shims set it, is never shared.
- The `typescript` peer accepts `>=5.5.0 <7.0.0`, so an Angular workspace on TypeScript 5.8 can install it. Every compiler API the discovery uses exists in 5.5, and the package's tests pass against 5.5.4.

**`@company/mfe-rspack`**

- React, `react-dom`, `sonner`, `@company/mfe-react`, both TanStack packages and the design system's non-singleton entries (`@tecton/react/`, `react-aria-components`, `recharts`, with the design system's own flags) are shared in `react@<installed react>`.
- A React container's registry entry and manifest now say `framework: "react"`.
- `hostShared` scopes every React-bound candidate by the React the host installed, and reads `@company/mfe-core` and `@company/mfe-runtime` beside `@company/mfe-react`, where the adapter's own imports resolve, rather than through `NODE_PATH`. `hostFederation` keeps `shareStrategy: 'loaded-first'`.

**`@company/mfe-nx`**

- The Angular group (`@angular/*`, `@angular/cdk`, `rxjs`, `@company/mfe-angular`) is shared in `angular@<installed @angular/core>`; the neutral packages stay in `default` and PrimeNG stays unshared. The adapter-carried page singletons are now planned by `@company/mfe-build`, so `adapterCarriedShares` is no longer exported here.

**`@company/mfe-core`**

- `ContainerDescriptor.shareScopes` is new: the scopes a host registers the container with. A descriptor without it shares in `default` alone.
