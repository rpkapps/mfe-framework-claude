---
'@company/mfe-core': minor
'@company/mfe-host': minor
'@company/mfe-react': minor
---

`StorageRetention` is now `'user' | 'browser'`, and the declaration property is
`storage` rather than `area`.

**`'session'` meant two different things in one declaration.** `storage:
'session'` picks `sessionStorage`, emptied when the tab closes. `retention:
'session'` bound a record to the signed-in identity, which is unrelated — so
`{ storage: 'local', retention: 'session' }` outlived every tab, and
`{ storage: 'session', retention: 'preference' }` still died with the tab.

**`'preference'` promised the opposite of what it did.** The physical key is
`<definitionId>:<name>` with no user component and the purge only removed
session-retained records, so a "preference" written while one person was signed
in was read back by the next person to sign in on that browser profile. The
word invited exactly the data it must not hold.

| was                       | now                    | meaning                                                   |
| ------------------------- | ---------------------- | --------------------------------------------------------- |
| `retention: 'session'`    | `retention: 'user'`    | the default; cleared when identity or groups change       |
| `retention: 'preference'` | `retention: 'browser'` | never cleared, and **shared by everyone on this browser** |
| `area:` (on `bind`)       | `storage:`             | matches what `useStoredState` already called it           |

`'user'` remains the default, so the only way to share state between users is to
ask for it by name.

**The persisted `r` field changed with the type.** Keeping the old strings on
the wire while the API said something else would have rebuilt the same
confusion one layer down, and the lab page tells developers to read the raw
envelope in devtools. Nothing is published yet, so there is no deployed data and
no compatibility shim to carry. A record written by an earlier build reports as
unreadable rather than being silently replaced by the declared default — the
documented behaviour for any record the framework cannot parse. Clear the
affected keys, or bump the key's `version` and declare `migrate()`.

`StorageArea` keeps its name: "storage area" is the Web Storage spec's term and
`StorageEvent.storageArea` is a real DOM property. Only the property that
selects one was renamed.
