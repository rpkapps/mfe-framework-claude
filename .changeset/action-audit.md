---
'@company/mfe-runtime': minor
---

Every action run is audited (§47). The executor records who acted (`actor`: the user, the agent on the user's behalf, or `'system'` for the host's own code, a new caller), the caller, the signed-in user, the chat `turn` an agent's call passes, the outcome with its reason or error code, the input with credentials redacted (`redactInput`: values under keys that name a credential, and strings that are a bearer or basic header of one token, a JWT or a PEM private key), and the timing. The runtime reports each record to telemetry as a `framework` record, operation `run action`, and hands it to `createMfeRuntime`'s new `auditAction` option for the host's backend to store.
