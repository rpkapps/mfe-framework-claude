---
'@company/mfe-runtime': patch
---

A theme switch through `createMfeRuntime({ theme })` now pauses CSS transitions for the one restyle it causes, so the whole page changes in a single frame instead of each control fading at its own speed, and an animation running at the same time (a menu closing) no longer stutters.
