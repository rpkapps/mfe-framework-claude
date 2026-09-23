---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
---

`retention` now defaults to `'browser'` rather than `'user'`: `DEFAULT_RETENTION` is `'browser'`, and a key that declares none is kept until its author asks for it to be cleared.

This is a behaviour change, not a rename. A record that declared no retention is no longer cleared when the signed-in identity or the semantic group set changes, and no longer waits for the session generation to be established before it can be read or written — which also means every user of that browser profile reads the same value. Anything derived from a user's data must now say `retention: 'user'` explicitly, in `bind()`, `bindHost()`, `storageFor().key()` and `useStoredState()` alike. The common case, impersonal UI state such as a display density or a collapsed panel, is what you now get by saying nothing (§21).

Records already on disk are read by their persisted `r` field, so one written as `'user'` stays fenced to its generation and is still removed by the next purge; it is rewritten as `'browser'` the first time a declaration that no longer names a retention writes to it.
