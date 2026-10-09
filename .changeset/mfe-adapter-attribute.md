---
'@company/mfe-runtime': minor
---

Both of a mount's roots now carry `data-mfe-adapter`, the definition's `framework` (`react`, `angular`), so page-wide CSS can treat one adapter's mounts differently. `createMountContext` and `applyScopeAttributes` take an optional `framework`, and `createOverlayRoot` an optional fourth argument, to stamp it; without one the attribute is left off.
