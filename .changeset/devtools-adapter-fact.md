---
'@company/mfe-devtools': patch
---

The registry view always names the adapter that read an entry, `react` included, because a shell lists every adapter and none is the usual one. The container lookup behind the overrides tab reads `isFederatedEntry` in place of the removed `containerNameOf`.
