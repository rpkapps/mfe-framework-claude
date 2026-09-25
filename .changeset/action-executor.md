---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
---

**Breaking:** running an action goes through one executor, and every caller says who it is (§40). `ActionRegistry.execute(id)` is `execute(id, { caller })`, where `caller` is `'palette'`, `'shortcut'`, `'ui'`, `'agent'` or `'system'` (the host's own code). An `executed` result carries the `value` the action's `execute` returned or resolved to; what `execute` receives, and how that value is checked, are in the entry on the action's fields. The denial notice carries the `caller`, and an agent's denial is returned to the agent without a notice. `@company/mfe-runtime` exports `ActionCall` and `ActionCaller`.
