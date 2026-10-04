---
'@company/mfe-core': patch
'@company/mfe-runtime': patch
'@company/mfe-angular': patch
'@company/mfe-nx': patch
'@company/mfe-rspack': patch
'@company/mfe-devtools': patch
'@company/eslint-plugin-mfe': patch
---

Every package now builds with `isolatedDeclarations`, so each export states its type and the public API check sees every type a consumer receives. The Angular host components' `state`, `attempt`, `error`, `inputState`, `inputStatus` and `inputError` fields and their outputs, and the adapter's injection tokens, now state the types they were inferred to have. `storedKey` is now a constant with a call signature and a `from` method rather than a function with a property attached; it is called the same way.
