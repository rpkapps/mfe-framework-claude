# Shared-state contract package

`@example/shared-state-contracts` owns the schema used by the React Lab and Angular Fieldwork.
Consumers depend on this package and import its declaration:

```ts
import { sharedStateSchema } from '@example/shared-state-contracts'
```

The example shell imports the compiled schema, which contains no Zod runtime:

```ts
import { schema } from '@example/shared-state-contracts/schema'
```

`src/index.ts` is the authoring source. After building the framework, `pnpm generate` emits the
compiled schema, package manifest and release policy. The files are checked in so a clean checkout
can discover consumer contracts before generation; the generator rewrites them only when their
content changes.

The release policy declares this example's first release with `baselines: []`. When publishing a
real contract package, preserve the previously released artifacts as baselines. Publish the
authoring export and compiled artifacts together. Deploy the current schema to the shell/backend
before a consumer starts requiring new fields.

See [the walkthrough](../shared-state/README.md) for the running React and Angular examples.
