---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
---

A stored record belongs to the browser profile, not to the signed-in user (§56). The framework never clears it at sign-out, and every user of the profile reads it, so nothing personal belongs in storage.

- **Breaking:** there is no `retention` option on `useStoredState`, `injectStoredState`, `bind()`, `bindHost()` or `storageFor().key()`, and `StorageRetention` and `DEFAULT_RETENTION` are gone from `@company/mfe-core`.
- **Breaking:** a stored record is `{ v, d }`; `StorageEnvelope` has no `r` or `g`. A record that still carries them reads as an ordinary one.
- **Breaking:** the session generation is gone: `MfeStorageStore` has no `establishSession`, `applySessionTransition` or `sessionGeneration`, `set()` and `remove()` take no write options, and `createMfeRuntime`, `createMemoryRuntime` and `createMfeTestEnvironment` take no `sessionGeneration`. `establishSessionGeneration`, `recordSessionGeneration` and `mintSessionGeneration` are replaced by `recordSessionIdentity(store, identity)`, which keeps the tab's `@host:session-identity` record so a boot can still discard another user's developer overrides.
