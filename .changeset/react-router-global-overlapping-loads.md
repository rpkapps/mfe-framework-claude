---
'@company/mfe-react': patch
---

Keep TanStack Router's development global hidden until all overlapping React container loads
finish. Remember routers published by mounts during those loads and restore the latest router
afterwards. This prevents the route HMR shim from copying another router's root component into
an App on its first evaluation, causing intermittent missing-runtime errors during navigation.
