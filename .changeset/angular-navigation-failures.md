---
'@company/mfe-angular': minor
---

An App's failed navigation reaches the mount instead of leaving an empty outlet. The router sends a `loadComponent` or `loadChildren` chunk that did not load, or a guard or resolver that threw, to the navigation's promise and a `NavigationError` event, never to the `ErrorHandler`, so the mount used to resolve over an empty `<router-outlet>` with nothing reported and an unhandled rejection.

- A failure before the App's first completed navigation is the mount's fatal failure, through the target's `onFailure`: the mount moves to its error state as `mount/failure`, and the host can offer a retry.
- A later failure is reported to the runtime's diagnostics as `mount/failure`, naming the route without its query or fragment, and the App stays on the route it was showing.
- **Behaviour change:** the mount sets the router's `resolveNavigationPromiseOnError`, keeping the App's other `withRouterConfig` options, because the router starts the first navigation and every one the bridge reports without holding their promises. A failed `router.navigate()` or `navigateByUrl()` now resolves `false` rather than rejecting; the failure is in the diagnostics instead.
