---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
---

**Breaking:** running an action goes through one executor, and every caller says who it is (§40). `ActionRegistry.execute(id)` is `execute(id, { caller })`, where `caller` is `'palette'`, `'shortcut'`, `'ui'` or `'agent'`. An `executed` result carries the `value` the action's `execute` returned, so `ActionRegistration.execute` is `() => unknown`. The denial notice carries the `caller`, and an agent's denial is returned to the agent without a notice. `@company/mfe-runtime` exports `ActionCall` and `ActionCaller`.
