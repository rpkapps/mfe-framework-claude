---
'@company/mfe-devtools': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
---

Add `@company/mfe-devtools`: a developer tools overlay for editing boot-time manifest overrides, enabled by `localStorage["company:mfe:devtools"]` or `?devtools=1` and gated at runtime rather than by `DEV` (§22).

- `@company/mfe-runtime` gains `writeDevOverrides`, beside its existing reader.
- `@company/mfe-react` gains `containerNameOf`, reporting a registry entry's federation container name.
- `createMfeRuntime` now calls `findConflictingContainerOverrides` at boot, diagnosing two definitions of one container pointed at different URLs.
