---
'@company/mfe-core': minor
'@company/mfe-host': minor
'@company/mfe-react': minor
---

An App now refuses a navigation with TanStack's own `useBlocker`, including navigations its router never sees; the mount registers one delegate with the host's navigator and answers it from the App's own blockers (§20).

Authors write nothing framework-specific: `useBlocker({ shouldBlockFn, enableBeforeUnload, withResolver: true })` is all that's needed; `useNavigationBlock` now remains only for a mount with no router of its own.

- `BoundaryNavigator` gains `readState`, `go`, and a `state` parameter on `push`/`replace`; `NavigationIntent` gains an optional `action`, and `createNavigationIntent` an optional fourth argument for it.
- `NavigationBlocker` gains `shouldBlockUnload()` and the navigator `wantsUnloadPrompt()`, which a host should call instead of counting registrations (§20).
- A mount may now register more than one blocker; a second registration no longer silently replaces the first.

A host opts in by routing its own navigations through `runtime.navigator.requestNavigation(...)`.
