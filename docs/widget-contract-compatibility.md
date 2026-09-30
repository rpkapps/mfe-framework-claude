# Keep a Widget and its consumers compatible

A consumer imports a Widget's contract when it builds. The Widget deployed later may have
changed. Before mounting it, the host checks that it still takes the inputs the consumer declares
and still emits the outputs the consumer expects.

## Steps

### 1. Pass the contract to the host

```ts
import { lazyWidget } from '@company/mfe-react'

import { inputSchema, outputSchema } from '@example/alert-panel/contracts'

export const AlertPanel = lazyWidget('alert-panel', {
  contract: { inputSchema, outputSchema },
})
```

In Angular, bind the same contract to `<mfe-widget [contract]="alertPanelContract">`.
The host checks it against the loaded Widget's own schemas, rather than the registry's copy.

### 2. Check what your change means for consumers

| Change to the Widget      | What an existing consumer sees                                                          |
| ------------------------- | --------------------------------------------------------------------------------------- |
| Add an optional input     | The Widget mounts.                                                                      |
| Add a required input      | The mount fails if the consumer's contract does not require it.                         |
| Accept fewer input values | The mount fails when the schemas show the consumer can pass a value the Widget refuses. |
| Remove an output          | The mount fails if the consumer's contract still declares it.                           |
| Add an output             | The Widget mounts; existing consumers need not subscribe to it.                         |
| Emit more payload values  | The mount fails when the schemas show the consumer cannot accept them.                  |

Inputs and outputs run in opposite directions. If a consumer declares `z.enum(['info', 'warning'])`
for an input, the Widget must accept both. If the Widget declares both for an output payload,
the consumer must accept both. Declaring an output does not promise how often it fires.

### 3. Keep the checks on actual values

The schemas may contain rules the comparison cannot read, such as `.refine(…)`. That result is
`unknown`, and the Widget still mounts. Its inputs and output payloads are checked when they
cross the boundary, as before.

`DynamicWidget` has no consumer contract. The Widget checks each input it is handed, but the
host cannot tell which outputs your code expects. Use `lazyWidget` with a contract when those
expectations are known at build time.

## Check it works

Leave `dismissed` in a consumer's `outputSchema`, then remove it from the Widget's own schema.
The mount fails with `contract/incompatible-widget` before the Widget renders. React's default
fallback shows the error; Angular emits `(failed)` and renders the consumer's fallback template.
The rest of the page stays mounted.

**Fix.** Keep the output, or update the consumer to the new contract and remove its handler.
For an input change, update the consumer's schema and the values it passes together.

## What the comparison can read

| Schema rule   | Checked                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Object fields | Declared properties, required fields and `additionalProperties`.                                                                         |
| Values        | Primitive types, integer versus number, enums and literals.                                                                              |
| Bounds        | Numeric limits, string length, array length and array item schemas. Repeated limits keep the stricter value.                             |
| Unions        | Each value or branch must fit a declared branch on the other side. If several branches might cover it together, the result is `unknown`. |
| Other rules   | Predicates, transforms, coercion, formats, `$ref`, intersections and unfamiliar schema details are `unknown`.                            |

A consumer's object schema may permit extra raw keys. Changing the Widget to a strict object
therefore returns `unknown`; the Widget's input validation decides whether the values passed
on that mount are valid. Comparison stops at a depth of 32 and does not run parses, refinements,
defaults, transforms or lazy factories.

`compareWidgetContracts` reads the supported Zod 4 rules without adding a schema converter to
the browser. `comparePublishedContracts` and `compareJsonSchemas` check published schemas;
they can only use the fields that were published.

Older hosts that pass only `consumerOutputs` still get the output checks. Checking inputs
requires `consumerContract`. Changing a bound contract checks subsequent output payloads
against the new binding; remount the Widget to run the full comparison again.

`onInputRejected`, `inputFallback` and `instanceId` belong to the host, so a Widget cannot
declare them as inputs. The output name `inputRejected` is also reserved: its handler would
be the host's `onInputRejected` callback.
