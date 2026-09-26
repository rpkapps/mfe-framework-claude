---
'@company/mfe-runtime': minor
---

A reload now keeps the session generation only for the identity and the group set it was minted for. The tab's record holds the signed-in groups beside the identity, sorted and without duplicates, and a record for other groups, or one written before groups were recorded, gets a fresh generation, so `retention: 'user'` records are wiped when the groups change even though the shell only sees new groups across a sign-in and a reload. `establishSessionGeneration(store, identity, groups, options?)` takes the groups as its third argument.

When a transition in the page mints a generation, `createMfeRuntime` now writes it to the record too, so a reload establishes the new generation rather than bringing back the one the transition retired. A host that assembles its own runtime does the same with `recordSessionGeneration(store, identity, groups, generation)`.
