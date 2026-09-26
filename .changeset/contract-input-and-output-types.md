---
'@company/mfe-core': minor
'@company/mfe-react': minor
---

Each side of a Widget's boundary is typed from its own end of the schema. A field with a `.default()` or a `.transform()` accepts one type and produces another, and every contract type was the produced one, so a consumer of `alert-panel` had to pass `severity` although the schema defaults it, and a transformed field was typed as what the Widget receives rather than what the consumer writes.

- **Behaviour change, types only:** `ContractInputs<C>` is the input schema's `z.input`, what a consumer passes, so `lazyWidget`'s props leave a defaulted input optional and take a transformed one as written. `ContractOutputs<C>` stays the parsed payload, what a consumer's `onX` handler receives.
- **New:** `ContractParsedInputs<C>`, what `render` receives, defaults filled in; and `ContractEmitPayloads<C>`, what `emit` accepts for each output, before its schema's defaults and transforms. `WidgetRenderProps` is typed from these two, so code that typed `render`'s `inputs` as `ContractInputs<C>` uses `ContractParsedInputs<C>`.
- Nothing changes at run time, and a schema without a default or a transform gives the same types as before.
