---
'@company/eslint-plugin-mfe': minor
---

The author presets and the `framework` preset reject `@company/mfe-agent` like any other agent library, so a container never imports the chat. In the `framework` preset, `packages/mfe-agent` may import `@ag-ui/*` and no other agent library.
