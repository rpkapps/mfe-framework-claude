---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
---

**Breaking:** commands are actions (§39). `CommandRegistration`, `CommandEntry`, `CommandPlacement` and `commandEntryEqual` are `ActionRegistration`, `ActionEntry`, `ActionPlacement` and `actionEntryEqual`; `CommandRegistry` and its option, handle, owner and result types are `ActionRegistry`, `ActionRegistryOptions`, `ActionRegistrationHandle`, `ActionOwner`, `ActionExecutionResult` and `ActionDenialNotifier`, and `commandId`/`commandIds` on a shortcut match and a denial notice are `actionId`/`actionIds`; `useCommand` is `useAction`, `injectCommand` is `injectAction`, `runtime.commands` is `runtime.actions` and `notifyCommandDenial` is `notifyActionDenial`. The placement `'command-palette'` is `'palette'`, and the error code `command/duplicate-name` is `action/duplicate-name`. An action's shortcut fires whatever its `placements` list, `[]` included.
