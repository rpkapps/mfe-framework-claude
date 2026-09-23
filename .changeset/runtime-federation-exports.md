---
'@company/mfe-runtime': minor
---

**Breaking:** `federationTarget` is no longer exported. It was public only so its own test could call it; the loader still falls back to the framework's expose convention, `./app` or `./widgets/<id>`, for an entry that names no `expose`.
