---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
'@company/mfe-build': minor
'@company/mfe-rspack': minor
'@company/mfe-nx': minor
---

Add compiled shared-state contracts, typed React and Angular bindings, router-accessible stores, scoped shell-owned state and a transactional persistence protocol. Mixed-version writes merge objects without deleting omitted fields, while production build gates reject unsupported evolution. Include generated artifacts, optional editor diagnostics, a reference backend, documentation and reproducible production measurements.

Configure `sharedState.schema` with the latest compiled schema. Runtime history lists and writer revision envelopes are removed; backward compatibility is enforced in build/release tooling. Object setters accept partial updates and merge recursively before validation in both browser and backend.
