---
'@company/mfe-rspack': minor
'@company/mfe-react': patch
---

A registry entry whose manifest cannot be loaded now costs the page only that surface (§30).

`@company/mfe-rspack/federation` exports `hostFederation({ root })`: the share scope `hostShared({ root })` already returns, plus `shareStrategy: 'loaded-first'`. A host should spread `hostFederation({ root: <package.json directory> })` into `moduleFederation.options` in place of `hostShared({ root })`.

`@company/mfe-react`'s federation loader now reports an unfetchable or unparsable manifest as `load/manifest-failure`, naming the manifest URL, instead of `load/entry-failure`; a chunk that fails after the manifest loads keeps `load/entry-failure`.
