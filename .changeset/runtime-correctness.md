---
'@company/mfe-runtime': patch
---

Five runtime fixes, none of which changes an API:

- A router that throws while following a URL change no longer keeps every later router on the page from hearing about it. The failure reaches the diagnostics hub, and every other subscriber is still told.
- `createSessionTokenService` gives up on a token refresh that has not settled within the load deadline (30 seconds), aborts the signal it gave the shell's `getToken` and `refreshToken`, and resolves `null`, so the next request tries again. The deadline is `DEFAULT_DEADLINES.load`, not a runtime's tuned one, because the service is built before the runtime. A refresh that never settled used to hold every authenticated request on the page.
- After a failed refresh, a retry that reports the rejected token refreshes again rather than being handed that same token back from the shell's store.
- A `user` save in flight when the signed-in user changes or the runtime is disposed now rejects with `storage/disposed` at once, as a queued save already did, even when the adapter ignores the abort and never settles.
- Search params sent to the agent with each turn are redacted by the action audit's rule: a param named like a credential (`token`, `apiKey`, `password`, `auth`) or holding one (a bearer or basic header, a JWT) arrives as `[redacted]`. That includes a cursor such as `pageToken`, so a param the agent should read or set must not be named with one of those words.
