# Change a Widget without breaking its consumers

A Widget can deploy separately from the Apps that render it. Those Apps still use the contract
they imported when they built. Keep the input values they send valid, and keep the output names
and payloads they handle.

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
Before mounting, the host checks that each output name the consumer declares still exists on the
loaded Widget. It uses the loaded definition, rather than the registry's copy.

The Widget validates the actual inputs on mount and update. Each emitted payload is checked
against the Widget's output schema, then the consumer's imported schema, before its handler runs.

### 2. Check what your change means for consumers

| Change to the Widget      | What an existing consumer sees                                                     |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Add an optional input     | Its existing inputs still pass.                                                    |
| Add a required input      | A mount fails if the values sent omit it. A later invalid update is refused.       |
| Accept fewer input values | A value the new schema refuses fails the mount or is refused on update.            |
| Remove an output          | The mount fails if the consumer's contract still declares that name.               |
| Add an output             | Existing consumers need not subscribe to it.                                       |
| Change an output payload  | A payload the consumer's schema refuses is reported and never reaches its handler. |

Keep a new input optional or give it a default until consumers send it. When changing a payload
would break an existing handler, add a new output name and keep the old one while consumers update.
The definition version names the build in diagnostics; raising it does not update the consumers.

### 3. Test the values existing consumers use

Try the inputs those consumers still send, including omitted fields and values your change might
refuse. Test the payloads their handlers expect too. Zod runs the full schema, including refinements,
defaults and transforms; the host does not compare the input types or bounds of the two schemas.

`DynamicWidget` has no consumer contract. The Widget still validates its inputs and outputs, but
the host has no expected output names or consumer payload schemas to check. Use `lazyWidget` with
a contract when those expectations are known at build time.

## Check it works

Leave `dismissed` in a consumer's `outputSchema`, then remove it from the Widget's own schema.
The mount fails with `contract/incompatible-widget` before the Widget renders. React's default
fallback shows the error; Angular emits `(failed)` and renders the consumer's fallback template.
The rest of the page stays mounted.

**Fix.** Keep the output, or update the consumer's contract and remove its handler.

Now make an input required and omit it from the values sent. The first mount fails with
`contract/input-mismatch`. On a later update, the Widget keeps its last valid inputs and reports
the rejection. Send a valid value or restore an optional input with a default.

## What each check covers

| Check                 | Applies to       | Checks                                                                |
| --------------------- | ---------------- | --------------------------------------------------------------------- |
| `requiresRuntime`     | Apps and Widgets | Whether the shell provides the framework API the container needs.     |
| Expected output names | Widgets          | Whether the loaded Widget still declares the consumer's output names. |
| Zod value validation  | Widgets          | The actual inputs on mount and update, and each emitted payload.      |

Hosts pass the whole `consumerContract`, with both schemas. React's `contract` option and Angular's
`[contract]` binding do this for you. Changing the bound contract replaces the mount and checks the
expected output names again. Declaring an output does not promise how often it fires.

`onInputRejected`, `inputFallback` and `instanceId` belong to the host, so a Widget cannot
declare them as inputs. The output name `inputRejected` is also reserved: its handler would
be the host's `onInputRejected` callback.
