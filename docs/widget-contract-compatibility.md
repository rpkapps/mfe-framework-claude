# Consumer and provider Widget compatibility

A typed `lazyWidget(id, { contract })` and an Angular `mfe-widget` with a `contract` binding
now pass the complete consumer contract to the neutral runtime. Before creating roots or
calling the provider's mount, the runtime compares that contract with the loaded definition's
actual contract. A registry descriptor alone cannot establish which code a mutable deployment
URL ultimately loads.

Inputs flow from consumer to provider: the provider must accept all values declared by the
consumer. Output payloads flow from provider to consumer: the consumer must accept all values
the provider emits after its own schema parsing. Each output name expected by the consumer
must still be declared. Adding a provider output is compatible. Output presence describes a
declared event, and does not promise that an event is emitted on every interaction.

| Result         | Runtime behavior                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `compatible`   | Mount normally; validate actual inputs and output payloads as before.                           |
| `incompatible` | Fail the affected host before provider mount with `contract/incompatible-widget`.               |
| `unknown`      | Mount normally; retain actual payload validation. No unsupported schema is asserted compatible. |

The checker supports object properties and required fields, additional property policies,
primitive types, integer/number inclusion, finite enums and literals, numeric bounds, string
length, array length and item schemas, and simple union inclusion. A union of narrower domains
that might collectively cover a broader domain is unknown unless individual inclusion can be
proved. Arbitrary predicates, transformations, coercion, `$ref`, intersections, formats, and
unfamiliar schema metadata are unknown. The checker does not execute schema parses,
refinements, defaults, transforms, or lazy factories during comparison.

`compareWidgetContracts` projects the supported data-only Zod 4 metadata locally. This adds
no JSON Schema validator or converter dependency to the browser. `comparePublishedContracts`
and `compareJsonSchemas` are available to tooling; their results are limited by the information
that was published. The comparison is bounded by a depth limit and does not claim general
JSON Schema implication. Input comparison covers declared fields. A tolerant consumer object
schema may accept undeclared raw keys that the host forwards, so a change to a strict provider
object is unknown; actual input validation determines whether that particular mount is valid.

Dynamic hosts have no compiled consumer contract. They continue to validate their configured
inputs against the provider on mount and update. The framework cannot infer which dynamically
named outputs a consumer intends to depend on. Supply a contract to opt into the preflight.

`consumerOutputs` remains supported for older direct runtime callers and older typed hosts.
It now preflights declared output names and payload compatibility, and still validates actual
event payloads. Input compatibility requires `consumerContract`; output-only expectations do
not invent an input requirement. A host changing its bound contract
must remount or retry to check the complete replacement; output validation always reads the
current binding. This feature does not negotiate deployment releases or recover removed chunks.

The host prop names `onInputRejected`, `inputFallback`, and `instanceId` are reserved. The
provider output `inputRejected` is also reserved because its generated handler would collide
with the host rejection callback.
