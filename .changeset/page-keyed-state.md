---
'@company/mfe-core': patch
'@company/mfe-runtime': patch
---

Nothing the containers on a page share is kept in one copy's module state, since a page may hold more than one copy of these packages (§55).

**`@company/mfe-core`**

- `isMfeError` recognises an error by a registered symbol rather than `instanceof`, so an error another copy of the core created keeps its code.

**`@company/mfe-runtime`**

- The mount-token sequence, the session `installShellAuth` installs and the active span context live on the page under registered symbols, so a container on another copy of the runtime reads the shell's session and never repeats a mount token.
