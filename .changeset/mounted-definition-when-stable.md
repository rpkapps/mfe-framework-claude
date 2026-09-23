---
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
---

A mount says when its framework has finished rendering, so a test waits on the mount rather than on a timer.

- **`MountedApp.whenStable?()` and `MountedWidget.whenStable?()`** are new and optional: they resolve once the definition's framework has rendered what it was last given. A definition without one is taken to render synchronously.
- **`DefinitionMount.whenStable()`** is new: it resolves through the mounted definition's own `whenStable`, and at once while nothing is mounted.
- **`@company/mfe-react`** mounts resolve it once the root's latest render has committed and its effects have run. **`@company/mfe-angular`** mounts resolve it with their application's `whenStable()`.
- **Breaking, `@company/mfe-angular`:** the `AngularMountedApp` and `AngularMountedWidget` types are gone, and an Angular definition's `mount` resolves to the neutral `MountedApp` or `MountedWidget`, without `injector`. The testing helpers' `injector` and `whenStable()` are unchanged.
