---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
'@company/mfe-build': minor
'@company/mfe-devtools': minor
'@company/create-mfe': minor
'@company/mfe-nx': minor
---

**Breaking:** a Widget's contract is `inputSchema` and `outputSchema`, and its events are outputs (§41). `createWidget` takes `inputSchema` (was `inputs`) and `outputSchema`, one `z.object` with a property per output (was `events`, a record of payload schemas); a Widget that emits nothing writes `z.object({})`. The registry publishes `contract.inputSchema` and `contract.outputSchema`, and no longer accepts a list of event names. The generated contract module exports `inputSchema`, `outputSchema`, `Inputs` and `Outputs`. Renamed: `describeWidgetInputs` → `describeInputs`, `describeWidgetEvents` → `describeOutputs`, `WidgetEvent` → `WidgetOutput`, `PublishedWidgetContract` → `PublishedContract`, `ContractEvents` → `ContractOutputs`, `eventNameToHandlerProp` → `outputNameToHandlerProp`, `findEventNameProblem` → `findOutputNameProblem`, `DynamicWidget`'s `onEvent` → `onOutput`, `<mfe-widget>`'s `(event)` → `(output)` with `MfeWidgetOutput`, the mount request's `onEvent`/`consumerEvents` → `onOutput`/`consumerOutputs`, the testing helpers' `events` → `outputs`, and the error code `contract/event-mismatch` → `contract/output-mismatch` with direction `'output'`. The generated `Outputs` type maps over the schema's shape, so an output declared through a spread or `.extend(…)` is typed too; the registry lists outputs only from a `z.object({ … })` literal, and publishes none for a spread, a computed key, or a method that changes the keys (`.extend`, `.merge`, `.omit`, `.pick`). New: `outputPayloadSchema(outputSchema, name)`, `outputSchemaError(id, outputSchema, renameRepair)` (why `createWidget` refuses an `outputSchema`, shared by the adapters) and the `OutputSchema` type.
