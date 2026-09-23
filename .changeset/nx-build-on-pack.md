---
'@company/mfe-nx': patch
---

A pack or publish refuses a `dist/` that is missing or older than the source. Nx loads its generators and executors from `dist/`, and a pack or publish used to ship whatever `dist/` the working tree held, stale or missing.
