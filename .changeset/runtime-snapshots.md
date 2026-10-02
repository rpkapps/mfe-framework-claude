---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
---

Add `runtime.getSnapshot()` for on-demand, detached diagnostic attachments,
available through both adapters' host entry points. Snapshots contain the
runtime API version, capture time, actual App and Widget placements with
lifecycle status and stable placement IDs, published registry builds, and
registry rejection reasons and codes. Duplicate placements are distinct,
retries preserve their placement ID, and disposed placements disappear
immediately. Snapshots omit DOM, services, raw errors and sources, contracts,
URLs, identity, storage and application payloads.

Raise runtime API metadata to 1.2.0 and the generated conservative requirement
to `>=1.2.0 <2.0.0`. Existing compatible 1.x containers continue to load on the
new runtime. No report UI, tracker integration or diagnostic history is added.
