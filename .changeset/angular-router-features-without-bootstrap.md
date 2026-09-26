---
'@company/mfe-angular': minor
---

`createApp` refuses the router features a mount cannot run, and a mount disposed while its application is still being created stops waiting for it.

- **Breaking:** a mount creates its application and attaches the App's root itself rather than bootstrapping it, so the router's bootstrap listener never runs. `createApp` now throws `app/invalid-router`, naming the feature and its index in `routerFeatures`, for the three features that start only from that listener: `withEnabledBlockingInitialNavigation()`, which held every navigation forever and so hung the mount; `withPreloading()`, which never preloaded; and `withInMemoryScrolling()`, which never restored scroll. Remove them. `withHashLocation()` and `withDisabledInitialNavigation()` are still accepted and change nothing, since the mount owns the location and the first navigation.
- A disposal while `createApplication` is still waiting on the definition's initializers now rejects the mount at once, as a disposal, instead of waiting for them. An application that finishes creating afterwards is destroyed. A mount that fails to create its application now releases its location strategy too.
