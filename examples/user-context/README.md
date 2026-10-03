# User context: React and Angular

Each definition can own a context schema. React Lab owns the selected well, survey, comparison setting,
and units in its `lab` slice. Angular Fieldwork reads that slice through a read-only binding. Its inspection Widget owns and persists its own `brief`.
This folder supplies shared well data and the local API's file repository. The shell's browser
adapter lives in `apps/shell/src/user-context-adapter.ts` and is passed directly to its normal
`createMfeRuntime` call beside the shell-owned schema.
The runtime registers generated owner contracts privately. The adapter and backend know only
opaque per-user owner documents; they import no Lab, Widget or shell schemas.

Definitions group authoring under `userContext: { schema?, reads? }`: `schema` belongs to that
definition, and `reads` declares the required subset of a foreign owner. Lab declares only its
schema, the inspection Widget declares its brief schema and Lab reads, and Fieldwork declares
only `reads: { lab: labSelectionReadSchema }`. The read schema lives with Fieldwork, independently of Lab.
Own selectors omit the owner ID; foreign selectors name `lab` and expose no setter.

## Run it

From the repository root:

```sh
pnpm build
pnpm generate
pnpm dev
```

Open <http://localhost:3000/lab/user-context>. Choose a well, change its survey or units, and toggle
baseline comparison in React. The Angular inspection widget reads those changes immediately.
Prepare an inspection to save a brief owned by the Widget. Close and reopen the Widget to recover
both the brief and the current Lab selection. Reload the shell to recover both owners’ saved data.
Use **Clear inspection brief** to remove the saved brief; Lab’s selection remains unchanged.

The Angular widget also appears at <http://localhost:3000/fieldwork/user-context>. Its foreign
Lab binding has no setter: the Lab review controls Lab's context. Its own binding omits an owner ID
and provides the setter for the brief. Lab’s `units` and `well-selection` keys and the Widget’s
`brief` each have visible read and write controls; the Fieldwork App has no owned context.

## Find the code

| Responsibility                        | File                                                  |
| ------------------------------------- | ----------------------------------------------------- |
| Lab-owned schema                      | `examples/lab/src/user-context.schema.ts`             |
| Inspection-owned schema and Lab reads | `examples/fieldwork/src/user-context.schema.ts`       |
| React owner hooks and partial writes  | `examples/lab/src/user-context-page.tsx`              |
| Angular foreign reader                | `examples/fieldwork/src/well-inspection.component.ts` |
| Browser transport                     | `apps/shell/src/user-context-adapter.ts`              |
| Local API                             | `tools/dev/api.mjs`                                   |
| Durable file repository               | `examples/user-context/server.mjs`                    |

## Local persistence and authorization boundary

The local API writes `.mfe/user-context-demo/records.json` with separate `documents` and `metadata`
objects. Each `documents[scope]` is an opaque owner map such as
`{ lab: { units: "imperial" }, shell: { preferences: { theme: "dark" } } }`.
The companion `metadata[scope][owner]` holds record revisions and retry receipts. Updating one owner
never rewrites another owner's value. No schema file or list of domain fields reaches the API. Stop the API before deleting that file
to restore defaults. Accepted writes flush the file, atomically rename it, and flush its directory.
The single-process repository serializes writes, checks revisions, and preserves retry receipts.
Earlier opaque demo records are converted without schemas, preserving values and retry metadata.
Hydration remains read-only; the next accepted save commits the new document layout.

This development API has no sign-in service. Its endpoints assign the local demo identity
`u-2841`, with no tenant or account ID, independently of the request body. The runtime handles
identity internally; the browser adapter sends no scope. The local API chooses its fixed demo
storage partition on the server.
Separate, explicitly configured endpoints grant writes to `lab`, `well-inspection` and `shell`;
each checks that submitted record IDs match the endpoint's fixed owner. These public local endpoints
are demo capabilities, not authentication. An arbitrary endpoint cannot select a new owner, and
forged `ownerId` fields cannot change the fixed owner of an endpoint.

A production integration must derive writer identity from its authenticated server request/session,
authorize the authenticated tenant/account/user before reading or writing, and use a transactional
database. A deployment with real sign-in must replace these fixed demo endpoints with an
authenticated API; the local API does not authenticate browser users.

Changes are live between MFEs in one shell, with no cross-tab broadcasting.

## Checks

```sh
pnpm --filter @example/user-context-demo test
pnpm --filter @example/user-context-demo typecheck
pnpm --filter @example/lab test
pnpm --filter @example/fieldwork test
```
