---
'@company/mfe-nx': patch
---

The `app` and `widget` generators write `@company/mfe-angular` and `@company/mfe-nx` at the range of the `@company/mfe-nx` release running them, `^<its version>`, instead of a fixed `^0.1.0`. On 0.x a caret range stops at the next minor, so after a release the fixed range pinned every new container to the framework before it. `@company/eslint-plugin-mfe` is released on its own version and stays a pinned range, which a test now keeps in step with the plugin's manifest: moving the plugin's version means moving `ESLINT_PLUGIN_MFE_VERSION` in `src/generators/shared/versions.ts` with it.
