# Shared state

Shared state is a shell-owned reactive store for independently deployed apps and widgets. Declare one Zod object whose top-level properties are shared-state IDs. Each ID has its own subscriptions, record revision and persistence operation.

```ts
import { sharedStateSchema } from '@example/shared-state-contracts'

export default createApp({ id: 'operations', router: makeRouter, sharedStateSchema })
// Angular definitions import the same package and supply their routes.
```

The shared contract package owns the Zod declaration. Consumers import it; they do not copy it.
See `examples/shared-state-contracts/src/index.ts` for that declaration and
`examples/shared-state/README.md` for the running React and Angular walkthrough.

The builder reads syntax without running app modules, emits per-key contracts and materialized TypeScript types, and **replaces the schema declaration with compiled references**. Authoring-only imports and local helpers are removed. An unsupported schema fails the build; metadata cannot weaken validation. A raw authoring declaration that reaches mounting fails before rendering.

## React and routing

```tsx
import { useSharedState } from '#mfe/shared-state'

function RunPicker() {
  const [selection, setSelection] = useSharedState('well:selection')
  async function choose(runId: string) {
    if (selection) await setSelection({ runId })
  }
  // Render selection and handle setter rejections in your interaction UI.
}
```

Keys and values are inferred from the declaration, including defaults. Setters accept partial object updates, complete arrays or scalar values, publish valid optimistic changes immediately, and resolve only after the persistence adapter reports durable acceptance. Invalid values reject without publication. Reads are immutable and fully materialized. Setters merge supplied object fields; they have no functional-updater or per-call persistence options. The first object update must provide required fields that have neither an existing value nor a schema default.

For the framework's TanStack Router, import its generated context types and keep the supplied context:

```ts
import type { AppRouterOptions, MfeRouterContext } from '#mfe/shared-state'

const root = createRootRouteWithContext<MfeRouterContext>()({})
const route = createRoute({
  getParentRoute: () => root,
  path: '/runs',
  loader: ({ context }) => {
    const selection = context.mfe.sharedState.get('well:selection')
    return fetchRuns(selection?.wellId)
  },
})
export function makeRouter({ basePath, history, context }: AppRouterOptions) {
  return createRouter({
    routeTree: root.addChildren([route]),
    basepath: basePath,
    history,
    context,
  })
}
```

The store is live across awaits. Router loaders and other imperative code use the same `get`, `set` and `subscribe` API as components. State changes do not automatically rerun route loaders: invalidate/revalidate when that is appropriate for your route.

A container with one shared-state definition gets `#mfe/shared-state`. Multiple definitions get `#mfe/shared-state/<definition-id>` and no ambiguous root alias. Each binding verifies the mounted definition; a widget cannot accidentally inherit its parent app's schema.

## Angular

```ts
import { injectSharedState, injectSharedStateStore } from '#mfe/shared-state'

@Component({ template: '{{ units() }}' })
export class UnitPicker {
  readonly state = injectSharedState('display:units')
  readonly units = this.state[0] // readonly Signal<'metric' | 'imperial'>
  readonly setUnits = this.state[1]
}

export const selectionResolver: ResolveFn<unknown> = () => {
  const store = injectSharedStateStore()
  return store.get('well:selection')
}
```

Call injectors in an injection context: component/service field initializers, guards or resolvers. Capture the store before an await. Signal subscriptions end with the injection context; state remains owned by the shell across unmount/remount.

## Shell and backend configuration

```ts
import { schema } from '@example/shared-state-contracts/schema'

const { runtime } = createMfeRuntime({
  // Existing shell options ...
  sharedState: {
    scope: opaqueTenantUserWorkspaceIdentity,
    schema,
    adapter: durableBackendAdapter,
    onError: reportSharedStateFailure,
  },
})
```

`schema` is the latest compiled shared-state schema from your contract package or build artifacts. Consumers still author `sharedStateSchema`; their generated bindings contain types, key references and required schema capabilities. Before hydration, the runtime checks those generated requirements against the current schema. Older consumers can use a newer additive schema; a newer consumer requiring fields absent from an older shell fails before mounting, rather than silently losing writes. No historical schema configuration is needed. The runtime and backend need only the current compiled schema. There is no runtime list of older contracts.

Updates merge recursively into the existing record and validate the complete result against this schema. Older, backward-compatible consumers can keep using their declared keys. Schema fingerprints remain build metadata; they are not a runtime allowlist. Release checks must establish backward compatibility before deploying a schema or consumer. Unknown keys and unsupported protocol versions still fail before mount.

Reads return the current complete snapshot, including additive fields newer consumers introduced. Older consumers may ignore those extra fields; a strict authoring schema is not reapplied to the snapshot at runtime. Missing records may materialize declared defaults without persisting on mount. Invalid records fail hydration and retain their persisted data; recovery must be explicit.

The shell calls `runtime.sharedState.setScope(nextOpaqueIdentity)` and remounts affected surfaces when tenant, user or workspace changes. Old bindings become unusable, pending promises reject, subscriptions are removed, and late hydration/write responses cannot reach the new scope. Collaborative workspace state requires its own configured scope; it is not automatically shared between users.

`@company/mfe-runtime/shared-state` exports the structural protocol and `createSharedStateBackend`. Supply a `SharedStateRepository` with `read` and a **transactional, durable** `transact` operation, plus authenticated read/write authorization. The server uses its current compiled schema, validates the existing record and the merged result, stores an idempotency receipt, and returns the authoritative record. Its promise must resolve after commit. Map transport conflicts and cancellation to the protocol, and provide an optional subscription for authoritative records.

The write envelope carries scope, ID, expected record revision, operation ID and the supplied update. It carries no writer schema or field mask. A compare-and-swap conflict rejects and refreshes without retrying the stale user intention. Local queued intentions keep their original expected revisions, so a remote change cannot silently overwrite a newer record. Clients replay newer optimistic intentions over older authoritative responses; scope cancellation does not depend on the adapter honoring abort.

Test helpers deliberately use memory and make no persistence guarantee. Production has no public memory-persistence selection and no offline/queued-acceptance substitute for a durable setter result.

## Merge-only writes

Object updates are partial and merge recursively. Every omitted property stays unchanged, including optional properties and defaulted properties. Defaults are materialized only where the merged value has no existing property. There is no property deletion operation.

```ts
// Existing: { wellId: '42', runId: '7', comparisonMode: 'overlay' }
await store.set('well:selection', { runId: '8' })
// Result:   { wellId: '42', runId: '8', comparisonMode: 'overlay' }
```

| Supplied update  | Result                                             |
| ---------------- | -------------------------------------------------- |
| Object           | Merge supplied fields recursively                  |
| Omitted property | Preserve existing value                            |
| Scalar           | Replace that value                                 |
| Array            | Replace the complete array, not individual items   |
| Explicit null    | Set the value to null, if nullable                 |
| Undefined        | Reject; it is not finite JSON or a deletion marker |

Null is an explicit value/reset, and array replacement is atomic. Neither omitted keys nor an empty object deletes existing fields. Domain logic owns dependent-field resets: changing a well does not automatically reset its comparison mode.

Run `node tools/shared-state/example.mjs` after building. The example independently compiles old/new consumer schemas, configures only the latest schema on the shell/backend and demonstrates that an old consumer update preserves newer fields. Both consumers see the complete shared record.

## Contract packages, release checks and diagnostics

Supported syntax includes finite JSON primitives, primitive literals, string enums, fixed objects, nullable/optional properties, arrays, deterministic literal defaults, string/array length bounds, number bounds and safe integers. Transforms, coercion, arbitrary refinements, dynamic defaults, recursion, unions, records and unsupported methods fail closed. Put sharedStateSchema directly on literal definition options without spreads so its declaration can be removed reliably.

Local exported const schemas can refer to other local schema consts and relative modules. A published domain package exports its authoring schema for TypeScript and also exports `<package>/shared-state.manifest.json`:

```json
{ "schemas": { "sharedStateSchema": { "formatVersion": 1, "contracts": [] } } }
```

Populate contracts with `compileSharedState` from `@company/mfe-build/shared-state`; each artifact contains its validated shape and deterministic SHA-256 revision. Publish these artifacts immutably with the domain package; export the current compiled schema separately from Zod authoring code so the shell does not need Zod. Source locations appear in compiler diagnostics and stay out of runtime payloads.

Production builds declaring state require `sharedStatePolicy: './deployment/shared-state-policy.json'` in their build options. The file contains the latest compiled `schema` and explicit `baselines` manifests. Empty baselines declare a first release; missing/unreadable policy is an error. Publishing CI must provide the trusted published baselines rather than allowing an app to rewrite its support history. `checkSharedStateRelease` and `compareContracts` expose the same checks for editor and publishing integrations. Lint suppression cannot bypass the production release gate.

Optional/defaulted additions within objects are compatible. Required additions, removals/renames, type/default/constraint/enum/nullability changes and changes within atomic array elements fail automatic approval. A root ID addition does not invalidate other keys. Diagnostics include rule, ID, property path, old/new shape and a repair. Use a new key with an explicit bridge for breaking changes, or retire incompatible consumers through a coordinated rollout. Structural checking cannot establish whether an ID was reused for a different domain meaning.

Generated deployment output includes a lightweight shared-state index and one JSON artifact per required key/revision. Repeated revisions are deduplicated within a container. Bindings contain types, definition identity and generated capability signatures, not a contract collection or compiler; production definitions contain references. Angular applies the declaration transform after its compiler emits JavaScript so the compiler cannot overwrite the replacement. The shell can load and cache artifacts by revision before configuring shared state. Compiler, compatibility baselines and Zod authoring code introduced solely by this declaration stay out of the consumer runtime graph.

## Editor diagnostics

The optional ESLint rule uses the same compiler and compatibility engine as production builds:

```ts
import { sharedStateRule } from '@company/mfe-build/shared-state-lint'
export default [
  {
    plugins: {
      sharedState: { rules: { contracts: sharedStateRule('./shared-state.policy.json') } },
    },
    rules: { 'sharedState/contracts': 'error' },
  },
]
```

Omit the policy path for schema-only authoring diagnostics. Production still requires an explicit policy and cannot be bypassed by an ESLint suppression. Keep baseline artifacts immutable in your published contract package or deployment history.

## Reproducible measurements

Run `node tools/shared-state/measure.mjs` after building. These esbuild 0.28.2 fixtures separate declaration code, shared contract payloads and the shell service. Framework adapters and Zod are external peers; the before column measures the authoring declaration, **not** the cost of downloading Zod. Compression of concatenated declarations is illustrative; separate network responses compress independently.

| Fixture         | Before JS bytes | After JS raw / gzip / Brotli | Contracts raw / gzip / Brotli | Revisions |
| --------------- | --------------: | ---------------------------- | ----------------------------- | --------: |
| one-app         |             230 | 386 / 290 / 235              | 257 / 191 / 156               |         1 |
| same-revision   |             463 | 775 / 304 / 244              | 257 / 191 / 156               |         1 |
| mixed-revisions |             496 | 858 / 376 / 316              | 584 / 254 / 217               |         2 |

The standalone shell store and validator bundle measures 10750 raw, 3889 gzip and 3446 Brotli bytes. These rows overlap with full framework package bundles and must not be summed with them. The inspected graphs contain no compiler, baseline history or Zod authoring modules. Generated payload tests verify one copy per revision per container.

Measured fixture budgets: at most 500 declaration bytes per app, one artifact per distinct revision per container, and zero retained authoring validators. The script enforces the declaration budget and graph exclusion. Timing is reported separately for in-process hydration, cached reads, validating 10,000 items and notifying 1,000 subscribers; it is machine/load-dependent and excludes network/database latency, so no universal timing budget is claimed.
