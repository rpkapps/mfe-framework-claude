---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
---

**Breaking:** running an action goes through one executor, and every caller says who it is (§40). `ActionRegistry.execute(id)` is `execute(id, { caller })`, where `caller` is `'palette'`, `'shortcut'`, `'ui'`, `'agent'` or `'system'` (the host's own code). An `executed` result carries the `value` the action's `execute` returned or resolved to; what `execute` receives, and how that value is checked, are in the entry on the action's fields. The denial notice carries the `caller`, and an agent's denial is returned to the agent without a notice. A call may pass a `signal`, as the chat does for its Stop: aborted before the run starts it runs nothing, and aborted while the run is queued or running it resolves `cancelled`, with a `reason`. `@company/mfe-runtime` exports `ActionCall`, `ActionCaller` and `DEFAULT_ACTION_TIMEOUT_MS`.
