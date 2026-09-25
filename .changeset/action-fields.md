---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
---

**Breaking:** an action declares what the agent needs, and every caller's run is checked against it (§42). `ActionRegistration` gains `description`, `inputSchema`, `outputSchema`, `effect` (`'read' | 'write' | 'destructive'`, undeclared counting as `'write'`), `needsApproval`, `parallelSafe` and `followUp`, and `execute` receives the parsed input. `'agent'` is a placement and one of the defaults, so an absent `placements` is `['palette', 'agent']`. `ActionRegistry.execute(id, { caller, input })` validates the input (`invalid`) and the returned value, and for an agent's call applies the approval policy (`actionApprovalPolicy` on `createMfeRuntime`, `actions.setApprover` for the surface that asks; `declined` when the user says no) and runs writes one at a time. `useAction` and `injectAction` return a run with the caller `'ui'`. An `ActionEntry` carries `description`, `effect`, `followUp` and both schemas as JSON Schema, and `actionEntryEqual` compares them. The handle's `qualifiedId` follows a rename.
