---
'@company/eslint-plugin-mfe': patch
---

The default export is the plugin object every preset registers as `mfe`, so a configuration can name it beside a preset — `{ plugins: { mfe } }` next to `...mfe.framework()`, to set an `mfe/` rule in a config object of its own — without ESLint throwing `Cannot redefine plugin "mfe"`. The presets registered a second object with the same rules, which flat config refuses under one name. The default export's type is exported as `MfePlugin`.
