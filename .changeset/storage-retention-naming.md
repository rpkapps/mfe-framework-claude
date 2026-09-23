---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
---

`StorageRetention` is now `'user' | 'browser'` (was `'session' | 'preference'`), and the declaration property is `storage` rather than `area` — matching what `useStoredState` already called it; `StorageArea` itself keeps its name.

`retention: 'session'` is now `'user'`, the default; `retention: 'preference'` is now `'browser'`, never cleared and shared by everyone on this browser (§21).

The persisted `r` field changed with the type, so a record written by an earlier build now reports as unreadable rather than being silently replaced by the default; clear the affected keys, or bump the key's `version` and declare `migrate()`.
