---
'@company/mfe-runtime': minor
---

One mount path: every host mounts every definition through `mountDefinition`, into an element it provides.

- `mountDefinition(request)` is new. It takes an App request (`kind: 'app'`, `basePath`) or a Widget request (`kind: 'widget'`, `inputs`, `onEvent`, and optionally `consumerEvents` and `onInputRejected`). It returns a `DefinitionMount`, or for a Widget a `WidgetDefinitionMount`: core's `MountHandle` plus the attempt's `context`, and for a Widget an `update(inputs)`.
  - It loads through the runtime's loader and never keeps a rejection. It mounts under `runtime.deadlines`, always after an `await` rather than from inside the caller's stack.
  - Each attempt gets a runtime-owned scope root with the definition's element inside it. `retry()` acts only from `error`.
  - A shallow-equal input set is dropped, and inputs that changed while the mount was pending arrive once, as its first update.
  - A payload the host's own contract refuses is reported to diagnostics, never thrown.
  - A mount placed inside another is one level deeper, and is disposed with it.
- `MountContext.scopeRoot` is new: the element carrying the mount's scope attributes. `createMountContext({ scopeRoot })` stamps the element it is given. With none, the context carries a detached one.
- Both mount targets take an optional `onFailure(error)`, for a fatal failure after the mount resolved. `mountDefinition` always provides it. The contract now also says that the runtime owns the scope and overlay roots, that `update` is called only on change, and that `dispose` is called once, asynchronously, before the context is disposed.
- `MountController.retry()` acts only from `error`. The failure and superseded paths now clean up as well as detach. `fail(error)` moves a mounted attempt to `error`, and one still attaching fails once its attach settles.
- `BoundaryNavigator.announce()` is new. It tells subscribers where a navigation the host made with its own router took the page, and emits nothing when they already know it.
