---
'@company/mfe-core': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
---

`isReservedInputName(name)` is exported from `@company/mfe-core/public`, and so from `@company/mfe-react` and `@company/mfe-angular`. It says whether a name is a host control prop (`instanceId`, `fallback`, `pending`, `inputFallback`, `key`, `ref`) or an `onX` handler rather than one of a Widget's inputs, so a host can drop those names from inputs it did not write, such as an agent's, before spreading them onto `<Widget>`.
