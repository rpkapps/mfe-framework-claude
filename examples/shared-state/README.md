# Shared state: React and Angular

The React Lab and Angular Fieldwork use the same package, `@example/shared-state-contracts`.
Neither App defines a local copy of the schema. This folder supplies the example shell's browser
adapter and the local API's file repository.

## Run it

From the repository root, install dependencies and run:

```sh
pnpm build
pnpm generate
pnpm dev
```

Open <http://localhost:3000/lab/shared-state>. The page mounts two independent MFEs side by side:

- **Survey review:** the React Lab App selects a well and reviews its surveys.
- **Inspection planner:** an Angular Widget from the Fieldwork container reads that selection
  and prepares an inspection brief. It receives no selection or units as props.

1. Choose **North Ridge 42** in React. Both panels show that well and its October survey.
2. Turn on **Compare with baseline**. The React review adds the baseline depth; Angular reads
   the same comparison setting.
3. Choose **Baseline survey** in Angular. React's survey picker and results change immediately.
   The well and comparison setting stay unchanged because Angular writes only `runId`.
4. Choose **Use feet** in Angular. Both panels convert the survey depth, and React's units
   picker changes to Feet.
5. Choose **Prepare inspection**. Angular creates a local brief for the selected well and survey.
6. Close the inspection panel, change the well in React and reopen the panel. Angular reads
   the current selection from the shell's store.
7. Reload the shell. Both MFEs read the saved selection. **Clear selected well** clears both panels.

The same Angular Widget also appears at <http://localhost:3000/fieldwork/shared-state>.
The well names and measured depths are sample survey data; the shared store holds only the
selection and units. An inspection brief is local draft state and is not submitted to a server.

## Find the code

| Responsibility                                      | File                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| Schema owner                                        | `examples/shared-state-contracts/src/index.ts`                       |
| Published schema artifacts and first-release policy | `examples/shared-state-contracts/generate.mjs`                       |
| React definition imports the package                | `examples/lab/src/mfe.ts`                                            |
| React hooks and partial writes                      | `examples/lab/src/shared-state-page.tsx`                             |
| Existing TanStack Router loader                     | `examples/lab/src/routes/shared-state.tsx`                           |
| Angular App and Widget import the package           | `examples/fieldwork/src/mfe.ts`                                      |
| Angular signals and partial writes                  | `examples/fieldwork/src/well-inspection.component.ts`                |
| Angular route resolver                              | `examples/fieldwork/src/shared-state.resolver.ts`                    |
| Shell configures the current compiled schema        | `apps/shell/src/boot.tsx` and `examples/shared-state/src/browser.ts` |
| Local API transport                                 | `tools/dev/api.mjs`                                                  |
| File repository                                     | `examples/shared-state/server.mjs`                                   |

## Local persistence

The local API writes `.mfe/shared-state-demo/records.json` in the repository root. Stop the API
before deleting that file to start again with defaults. Each accepted write flushes the file and
atomically renames it; the repository serializes writes and the backend checks record revisions.

This is a single-process development example with a fixed workspace and no sign-in check. A
production adapter talks to your authenticated backend and uses its transactional database. The
example does not broadcast changes between browser tabs; both Apps in one shell share a live store.

## Checks

```sh
pnpm --filter @example/shared-state-demo test
pnpm --filter @example/lab typecheck
pnpm --filter @example/lab test
pnpm --filter @example/fieldwork typecheck
pnpm --filter @example/fieldwork test
```
