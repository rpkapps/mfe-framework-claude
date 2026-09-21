---
'@company/mfe-react': patch
---

Three fixes: `AppHost` now remounts on App change instead of reusing the previous mount's loader; `lazyWidget` and `DynamicWidget` each get their own Suspense boundary; `useBreadcrumbs([])` no longer clears the App's route-derived crumbs.

`lazyWidget` and `DynamicWidget` take an optional `pending` prop for what shows while that Widget loads; `pending` is reserved and never forwarded to the Widget as an input.

`useBreadcrumbs([])` is now _no override_, not an empty trail; an App that contributes no crumbs at all should instead set `contributesBreadcrumbs: false` on its definition.
