---
'@company/mfe-angular': patch
---

An Angular Widget's `injectWidgetEmit` types each payload from what its `outputSchema` accepts (`ContractEmitPayloads`), as the React adapter's `emit` now does, and the repair for a reserved output name lists `pending` with the host's other reserved names.
