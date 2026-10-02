# User context: React and Angular

Each MFE owns its context schema. React Lab owns the selected well, survey, comparison setting,
and units in its `lab` slice. Angular Fieldwork reads that slice through a read-only binding.
This folder supplies the example shell's browser adapter and the local API's file repository.
The host aggregates the JSON artifacts published by Lab and Fieldwork; there is no global
contract package.

## Run it

From the repository root:

```sh
pnpm build
pnpm generate
pnpm dev
```

Open <http://localhost:3000/lab/user-context>. Choose a well, change its survey or units, and toggle
baseline comparison in React. The Angular inspection widget reads those changes immediately.
Prepare an inspection to see a local draft brief. Close and reopen the widget to see the current
Lab selection. Reload the shell to recover the saved Lab selection and units.

The Angular widget also appears at <http://localhost:3000/fieldwork/user-context>. Its foreign
Lab binding has no setter: the Lab review controls Lab's context. Inspection briefs remain local
component state and are not persisted by this development API.

## Find the code

| Responsibility                          | File                                                  |
| --------------------------------------- | ----------------------------------------------------- |
| Lab-owned schema                        | `examples/lab/src/user-context.schema.ts`             |
| Fieldwork-owned schemas                 | `examples/fieldwork/src/user-context.schema.ts`       |
| Per-container published artifacts       | Each container's `user-context.schema.json`           |
| React owner hooks and partial writes    | `examples/lab/src/user-context-page.tsx`              |
| Angular foreign reader                  | `examples/fieldwork/src/well-inspection.component.ts` |
| Host artifact aggregation and transport | `examples/user-context/src/browser.ts`                |
| Local API                               | `tools/dev/api.mjs`                                   |
| Durable file repository                 | `examples/user-context/server.mjs`                    |

## Local persistence and authorization boundary

The local API writes `.mfe/user-context-demo/records.json`. Stop the API before deleting that file
to restore defaults. Accepted writes flush the file, atomically rename it, and flush its directory.
The single-process repository serializes writes, checks revisions, and preserves retry receipts.

This development API has no sign-in service. Its server configuration grants one fixed writer,
`lab`, in the isolated `user-context-example` workspace. Submitted slice IDs and owner fields do
not determine the authorized writer; attempts to write another owner's slice are rejected. The
browser adapter cannot persist the Fieldwork or inspection slices through this bounded endpoint.
This demonstrates the ownership check, not production authentication. A production integration
must derive the writer identity from its authenticated server request/session and authorize the
user's workspace before reading or writing its transactional database.

Changes are live between MFEs in one shell, with no cross-tab broadcasting.

## Checks

```sh
pnpm --filter @example/user-context-demo test
pnpm --filter @example/user-context-demo typecheck
pnpm --filter @example/lab test
pnpm --filter @example/fieldwork test
```
