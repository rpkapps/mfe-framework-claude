---
'@company/mfe-runtime': minor
---

`WidgetMountTarget.onFailure` and `AppMountTarget.onFailure` are now required. Both adapters' `mountDefinition` already supplied them on every attempt, so this only closes the type to match; a definition that mounts itself outside `mountDefinition` must now pass one.
