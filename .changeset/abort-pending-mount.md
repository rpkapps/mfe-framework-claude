---
'@company/mfe-runtime': patch
---

A mount torn down while its definition is still mounting now has its `context.signal` aborted first, so a definition that stops on abort ends the mount instead of holding the teardown until it settles. A mount already in place is still disposed before its signal aborts. `MountContextHandle` gains `abort()`.
