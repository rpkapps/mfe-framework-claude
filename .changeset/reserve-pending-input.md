---
'@company/mfe-core': minor
'@company/mfe-runtime': patch
'@company/mfe-react': patch
---

**Breaking:** `pending` is a reserved input name. `lazyWidget`'s component and `DynamicWidget` take `pending` as the slot shown while the Widget loads and never forward it, so an input of that name passed contract validation and then never reached the Widget. `RESERVED_INPUT_NAMES` is now `key`, `ref`, `fallback` and `pending`: the build rejects a contract that declares it, and a mount whose inputs produce it fails with `contract/input-mismatch`, whose repair names `pending` beside the others. The React hosts split a consumer's props with `isReservedInputName`, so the props they keep and the names a contract may not declare are one list. A Widget with a `pending` input renames it, for example to `isPending`.
