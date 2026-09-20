---
'@company/mfe-rspack': minor
---

`@company/mfe-rspack/federation` exports `hostShared({ root })`: the `shared`
map for a federation **host's** `moduleFederation.options`, from the same
candidate list, singleton and eager rules and prefix-share version rule
`pluginMfe()` gives a container.

```ts
import { hostShared } from '@company/mfe-rspack/federation'

moduleFederation: {
  options: {
    name: 'shell',
    remotes: {},
    shared: hostShared({ root: here }), // the directory holding package.json
  },
}
```

A host advertises the version it installed rather than the range it declared,
and shares what it can resolve rather than what it lists: `@company/mfe-core`,
reached through the adapter and never declared as a dependency, is provided; a
candidate that resolves nowhere is left out. Resolving none of them is a build
error naming the repair, because a host that shares nothing cannot mount
anything.

It is a subpath rather than part of the package root: the root is `pluginMfe()`
and everything a container's build needs, and a host runs none of it.
