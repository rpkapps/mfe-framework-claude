---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
---

**Breaking:** an action's failures each have a code of their own (§43). `action/duplicate-name` now means only a duplicate name. An invalid registration throws `action/invalid-registration`, a shortcut that will not fire is reported as `action/shortcut-refused`, and a run of an action that is no longer registered returns `action/unavailable`, including after an agent's call waited while its mount went away.
