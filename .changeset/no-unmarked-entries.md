---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
---

No path for builds from before a field existed (§53): `createFederatedAdapter` no longer takes `claimsUnmarked`, and the React adapter no longer claims an entry whose `mfe` marker names no framework, which the registry now rejects as unrecognised. `ContainerDescriptor.framework` and `shareScopes` are required.
