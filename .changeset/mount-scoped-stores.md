---
'@company/mfe-runtime': minor
---

A disposed mount is cleared from every store that keeps records per mount at once (§44). `BreadcrumbStore` gains `removeMount(token)`, so a mount's crumbs and any override inside it go when the mount is disposed rather than when its component's cleanup runs, and a handle whose records were already removed does nothing: an `ActionRegistrationHandle.update` after its mount was cleared no longer puts the action back, even one that renames it.
