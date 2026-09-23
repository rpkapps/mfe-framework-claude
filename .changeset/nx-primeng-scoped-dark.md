---
'@company/mfe-nx': patch
---

A generated container's PrimeNG controls now all follow the shell's dark theme. `src/primeng.ts` hands PrimeNG the Aura preset through `redeclaredForScopedDarkMode()`, which repeats every token in the preset's dark scheme. PrimeNG resolves a light variable's references on `:root`, so under a dark class on the mount's scope root a select, and every other control whose tokens Aura gives no dark value, stayed light while a button went dark. The generated App's spec checks the select's variables are declared again for the dark class.
