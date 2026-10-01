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

Open the shell at <http://localhost:3000> and use these pages:

- React: <http://localhost:3000/lab/shared-state>
- Angular: <http://localhost:3000/fieldwork/shared-state>

1. In the React Lab, select well 42 and enable overlay.
2. Open the Angular page. It shows well 42, run 7 and overlay. Its resolver also reads well 42.
3. Choose **Change only run** in Angular. The run changes to 8; the well and overlay remain.
4. Return to the React page. Its hooks and TanStack route loader read the same selection.
5. Switch units in either App and open the other. Both use the saved units preference.
6. Reload the shell. The local API reads the saved records from disk.
7. Clear the selection. Both frameworks read null instead of a well.

The React page also has a second units subscriber so you can see immediate updates without
switching pages. Setters are awaited and failures remain visible next to the controls.

## Find the code

| Responsibility                                      | File                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| Schema owner                                        | `examples/shared-state-contracts/src/index.ts`                       |
| Published schema artifacts and first-release policy | `examples/shared-state-contracts/generate.mjs`                       |
| React definition imports the package                | `examples/lab/src/mfe.ts`                                            |
| React hooks and partial writes                      | `examples/lab/src/shared-state-page.tsx`                             |
| Existing TanStack Router loader                     | `examples/lab/src/routes/shared-state.tsx`                           |
| Angular definition imports the package              | `examples/fieldwork/src/mfe.ts`                                      |
| Angular signals and partial writes                  | `examples/fieldwork/src/shared-state.component.ts`                   |
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
pnpm --filter @example/fieldwork typecheck
pnpm --filter @example/fieldwork test
```
