---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
'@company/mfe-build': minor
'@company/mfe-devtools': minor
---

One storage API for local, session and user values (§57). A value is declared once as a key, and the same key is read and written in every area.

- `storedKey(name, schema.default(...), { storage?, perInstance?, version?, migrate? })` declares a value; `storage` is `'local'` (the default), `'session'` or `'user'`. The schema's default is what an absent value reads as, and a schema without one does not type-check. `storedKey.from(owner, name, schema, options)` reads a `user` value another definition, or `@host`, owns; it is read-only. `@company/mfe-react` and `@company/mfe-angular` re-export `storedKey`.
- **Breaking:** `useStoredState(key, { select? })` returns `{ value, set, status, error, retry, reset }` instead of a `[value, setValue]` tuple; a read-only key has no `set` or `reset`. `set` returns a promise, and a failed write rolls back and sets `status: 'error'` instead of throwing during render. The value is the schema default while loading or after an error, never `undefined`.
- **Breaking:** `injectStoredState(key, { select? })` returns signals `value`, `status` and `error`, plus `set`, `reset` and `retry`, instead of `{ value, set, remove }`.
- **Breaking:** `MfeStorage` is keyed: `get`, `peek`, `set`, `reset`, `subscribe` and `status`. `storage.key(name, schema, options)`, `remove(name)` and `clear()` are gone. `useMfeStorage()` and `injectMfeStorage()` take no area and work outside a mount, owned by `@host`. `context.mfe.storage` is one `MfeStorage` instead of `{ local, session }`.
- **Breaking:** `scope: 'instance'` is replaced by `perInstance: true` on the key. A `perInstance` key without a host `instanceId` fails with `storage/invalid-value`.
- **Breaking:** `runtime.storage` is a `StorageService` (`bind(caller, key)`, `forCaller(caller)`, `whenLoaded()`); the browser store is `runtime.storage.browser`, and its imperative `storageFor()` and `hostStorage()` are removed.
- `createMfeRuntime({ storage: { user } })` takes the `user` area's backend: `load(signal)` returns the signed-in user's whole table (`owner → key → { v, d, revision }`), `save(owner, key, value | null, signal)` stores one key, and the optional `sync(handle, signal)` keeps it fresh through `handle.replace(state)`. The runtime loads it before Apps mount and again when the user changes; saves are last-write-wins per key, with one save in flight per key. A failed load mounts Apps with defaults and `status: 'error'`, and `retry()` loads again.
- New error codes `storage/unauthorized-owner`, `storage/invalid-value`, `storage/not-ready`, `storage/disposed` and `storage/persistence-failed`. Every rejected write is a `StorageError` carrying one. `storage/failure` remains for failures of the browser store itself.
- Testing: `createMfeTestEnvironment`, `renderApp` and `renderWidget` take `storage: [[key, value]]` to seed values in any area, `userStorage` for the `user` backend, and `instanceId`. `createMemoryRuntime({ storage: { user?, values? } })` and `createMemoryUserStorage(rows)` are exported from `@company/mfe-runtime/testing`.
- The devtools panel has a read-only **Storage** tab for the `user` area: the load, and every value by owner and key with its status, data and row.
- Nothing is generated for stored values: a key is a plain import, so the build emits no storage bindings.
