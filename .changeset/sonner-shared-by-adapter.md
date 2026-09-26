---
'@company/mfe-rspack': patch
---

`sonner` is shared as a strict singleton in the React scope because the adapter's own policy lists it, not because the design system's contract does. Tecton's `@tecton/react/federation/shared` now declares no singletons, since it is written for applications that share no scope; without this a container could queue its toasts on a copy of `sonner` that the shell's `Toaster` never reads.
