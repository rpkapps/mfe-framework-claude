# @example/fieldwork

An Angular 19 App, zoneless and on PrimeNG, that the shell mounts beside the React examples. Its id
is `fieldwork` and its dev server is on port 3007. `@company/mfe-nx`'s `app` generator wrote it, and
it builds the way a generated container does: Nx's Angular webpack builder with `withMfe()` as the
`customWebpackConfig` (`webpack.config.ts`).

- `/` lists the inspections at the well pad chosen in a PrimeNG select. The PrimeNG button, and the
  `f l` shortcut on the palette command the page registers, log a walkdown as the user
  `injectUser()` reads from the shell.
- `/inspections/:inspectionId` shows one inspection; the router binds the parameter to an input.
- `/settings` is the App's settings capability, which the shell lists in its own settings.

## An Nx workspace of its own

The repository is not an Nx workspace, so this directory is one: `nx.json` and `tsconfig.base.json`
make it the workspace root, and `project.json` is the project at its root, with the targets the
generator wrote. The package scripts follow the React examples' names, so `pnpm dev`,
`pnpm run build:mfes` and `pnpm verify:page` find it as they find them:

| Script      | Runs                                            |
| ----------- | ----------------------------------------------- |
| `dev`       | `nx serve fieldwork`                            |
| `build`     | `nx build fieldwork`, never replayed from cache |
| `generate`  | `nx run fieldwork:generate`, writing `.mfe/`    |
| `typecheck` | `nx typecheck fieldwork`                        |
| `test`      | `nx test fieldwork`, the generated spec         |

Every Nx target but `generate` runs `generate` first. Each script builds `@company/mfe-nx` before
it runs Nx, because Nx loads a plugin's generators, executors and `withMfe()` from its compiled
output, which is not checked in. The build is never replayed from Nx's cache: the framework
packages it compiles are outside this workspace, so Nx cannot see them change.

`pnpm lint` at the repository root lints this directory with the `eslint.config.ts` here, the
generator's `@company/eslint-plugin-mfe/angular` preset; `nx lint fieldwork` runs the same
configuration from here.

## Versions

Angular 19.2 compiles only with TypeScript below 5.9, and its component tests run on Vitest 4, so
this example takes `typescript`, `vitest`, `vite` and `jsdom` from the `angular` catalog in
`pnpm-workspace.yaml`. Everything else comes from the default catalog, at the versions the generator
pins.

`@company/mfe-angular` and the packages beneath it still publish TypeScript source, which
TypeScript never emits when it reaches it through `node_modules`. `tsconfig.app.json` and
`tsconfig.spec.json` therefore list their sources as files of this program; that goes once the
packages ship compiled output.
