---
'@company/mfe-rspack': minor
'@company/mfe-react': patch
---

A registry entry whose manifest cannot be loaded costs the page that one
surface again, instead of taking the chrome down with it.

`@company/mfe-rspack/federation` exports `hostFederation({ root })`: the share
scope `hostShared({ root })` already returned, plus the `shareStrategy` that
belongs with it. A host spreads it into `moduleFederation.options`:

```ts
import { hostFederation } from '@company/mfe-rspack/federation'

moduleFederation: {
  options: {
    name: 'shell',
    remotes: {},
    ...hostFederation({ root: here }), // the directory holding package.json
  },
}
```

Module Federation's default strategy, `version-first`, re-initialises **every**
registered remote before resolving **any** share, so one remote whose manifest
404s or whose server is not running rejected the host's own resolution of
`react`, the design system and the framework packages — every chunk the host
fetched after that remote was registered failed, including the ones its chrome
renders from. `loaded-first` resolves against the share scope as it stands, so
a registered remote is contacted only when something loads from it. It also
stops a remote's copy of a shared module replacing the host's in the scope, so
a container built against a different version of the design system can no
longer hand the host components its own build never had.

`@company/mfe-react`'s federation loader now reports a container whose manifest
could not be fetched or parsed as `load/manifest-failure`, naming the manifest
URL, rather than as `load/entry-failure` pointing at a chunk that was never
requested. A chunk that failed after the manifest loaded keeps
`load/entry-failure`.
