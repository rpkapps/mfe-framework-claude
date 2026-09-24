---
'@company/mfe-core': minor
'@company/mfe-runtime': minor
'@company/mfe-build': minor
'@company/mfe-react': minor
'@company/mfe-angular': minor
'@company/mfe-devtools': patch
---

A Widget's published `contract.events` is now a JSON Schema in the same shape as `contract.inputs`: one property per declared event, in declaration order, each the schema of that event's payload. A payload the build cannot read statically is `{}`; `events` is absent when the event names themselves cannot be read.

- `PublishedWidgetContract.events` is `JsonSchemaObject | undefined`, where it was `readonly string[]`.
- `describeWidgetEvents(contract)` (in `@company/mfe-core`, re-exported from `@company/mfe-react` and `@company/mfe-angular`) returns each event's `name`, `schema` and `payload` fields, read by the same walk as `describeWidgetInputs`; `null` means the names could not be read, `[]` means the Widget emits nothing.
- The registry reader still accepts the list of names an older build published, as those events with unknown payloads, so upgrade the shell before rebuilding containers.

`@company/mfe-devtools` reads an entry's events through `describeWidgetEvents`.
