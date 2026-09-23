---
'@company/mfe-nx': patch
---

The package builds before it is packed. Nx loads its generators and executors from `dist/`, and a pack or publish used to ship whatever `dist/` the working tree held, stale or missing.
