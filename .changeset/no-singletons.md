---
'@company/mfe-build': minor
'@company/mfe-rspack': minor
'@company/mfe-nx': minor
---

Nothing is shared as a singleton, because containers are released from repositories of their own (§55). Every `shared` entry a container or a host is built with is `singleton: false, strictVersion: false`. A container takes the loaded copy its range accepts, so containers whose ranges agree still download one copy, and a container whose range nothing loaded satisfies loads its own copy instead of failing with "does not satisfy the requirement". The share scopes are unchanged.

**`@company/mfe-build`**

- **Breaking:** `SharingPolicy` has no `singleton` or `strictVersion` fields; a policy decides only the scope (`frameworkScoped`) and `eager`. `SINGLETON` and `PAGE_SINGLETON` are replaced by `FRAMEWORK_SCOPED` and `PAGE_WIDE`.
- **Breaking:** `SharedModuleConfig.singleton` and `.strictVersion` are typed `false`.
- An author's `shared` override adds a candidate to the framework scope or restates an existing candidate's range, keeping its policy (a lazily loaded candidate stays lazy); it no longer tightens one to a singleton.

**`@company/mfe-rspack`**

- **Breaking:** `@company/mfe-react` is no longer shared: each container bundles its own, so the Query client and router it provides are the copies the container's own code imports. A host no longer shares it either.
- React, `react-dom`, the TanStack packages, React's entry points and the design system's list share in `react@<installed react>` without `singleton` or `strictVersion`. The design system contract's singleton flags are no longer read; its `eager` flag still is.

**`@company/mfe-nx`**

- **Breaking:** `@company/mfe-angular` is no longer shared: each container bundles its own, so the router classes and tokens it compares are the container's own.
- The Angular group shares in `angular@<installed @angular/core>` without `singleton` or `strictVersion`.
