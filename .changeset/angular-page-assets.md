---
'@company/mfe-angular': minor
'@company/mfe-nx': minor
---

A host now loads what every Angular container relies on and none of them ships, such as a UI library's design tokens or an icon font, before the first Angular container mounts.

**`@company/mfe-angular`**

- `createAngularAdapter({ pageAssets })` from `/registry` builds the Angular adapter with the host's `pageAssets` function. It runs once per page, inside the adapter's `aroundLoad`, in parallel with the first Angular container's own download, and every Angular load waits for it, so the mount stays `pending` (the host's loading state) until the assets have arrived and nothing paints unstyled. A page that loads no Angular container never runs it. A rejection fails the waiting load as `load/entry-failure` naming that definition, and is forgotten, so a retry runs it again. `angularAdapter` is `createAngularAdapter()` and is unchanged. `AngularAdapter` and `AngularAdapterOptions` are exported beside it.

**`@company/mfe-nx`**

- **Breaking for generated containers:** the generated `src/primeng.ts` gives PrimeNG no preset, `providePrimeNG({})`, so PrimeNG declares none of its `--p-*` variables and its components only read them: the host declares them for the whole page, through `pageAssets`, and switches them with its theme class on `<html>`. `redeclaredForScopedDarkMode()`, `PRIMENG_DARK_CLASS` and the environment initializer that toggled it on the mount's roots are gone, and `@primeng/themes` is no longer a generated dependency. A container generated earlier still declares Aura's variables itself, page-wide, where they compete with the host's: replace its `src/primeng.ts` with the generated one and drop `@primeng/themes`. The generated App's spec checks that PrimeNG declares no variables of its own and that its button reads `--p-button-primary-background`.
