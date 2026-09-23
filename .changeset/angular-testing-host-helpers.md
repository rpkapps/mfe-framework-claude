---
'@company/mfe-angular': minor
---

`@company/mfe-angular/testing` exports the host-side helpers the adapter's own tests use.

- **`createHostApplication(environment, providers?)`** boots a zoneless application with the environment's runtime provided and no mount around it, where shell chrome and host components live. Pass `null` for one without a runtime.
- **`renderInHost(appRef, component, setup?)`** renders a component as a root view of that application, in an element attached to `document.body`, and resolves once it has settled. `RenderedHost` is its result.
- `cleanup()` now destroys those applications and removes those elements too, as it disposes the mounts `mountApp` and `mountWidget` made.
- `injectCommand` with a factory runs the factory and `canExecute` once for each change of the signals they read, where it used to evaluate `canExecute` twice.
