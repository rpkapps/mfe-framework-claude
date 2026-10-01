# Shared state

Shared state is a shell-owned reactive store for independently deployed apps and widgets. Declare one Zod object whose top-level properties are shared-state IDs. Each ID has its own subscriptions, record revision and persistence operation.

```ts
export const sharedStateSchema = z.object({
  'well:active-selection': z
    .strictObject({
      wellId: z.string(),
      runId: z.string().nullable(),
    })
    .nullable()
    .default(null),
  'display:units': z.enum(['metric', 'imperial']).default('metric'),
})

export default createApp({ id: 'operations', router: makeRouter, sharedStateSchema })
// Widgets and Angular apps declare sharedStateSchema in the same place.
```

The builder reads syntax without running app modules, emits per-key contracts and materialized TypeScript types, and **replaces the schema declaration with compiled references**. Authoring-only imports and local helpers are removed. An unsupported schema fails the build; metadata cannot weaken validation. A raw authoring declaration that reaches mounting fails before rendering.

## React and routing

```tsx
import { useSharedState } from '#mfe/shared-state'

function RunPicker() {
  const [selection, setSelection] = useSharedState('well:active-selection')
  async function choose(runId: string) {
    if (selection) await setSelection({ wellId: selection.wellId, runId })
  }
  // Render selection and handle setter rejections in your interaction UI.
}
```

Keys and values are inferred from the declaration, including defaults. Setters accept materialized values, publish valid optimistic changes immediately, and resolve only after the persistence adapter reports durable acceptance. Invalid values reject without publication. Reads are immutable; setters accept values, without patch, functional-updater or per-call persistence options.

For the framework's TanStack Router, import its generated context types and keep the supplied context:

```ts
import type { AppRouterOptions, MfeRouterContext } from '#mfe/shared-state'

const root = createRootRouteWithContext<MfeRouterContext>()({})
const route = createRoute({
  getParentRoute: () => root,
  path: '/runs',
  loader: ({ context }) => {
    const selection = context.mfe.sharedState.get('well:active-selection')
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

The store also works with React Router data loaders and actions. Capture the injected store when constructing routes; callbacks call it without hooks:

```tsx
import { useSharedStateStore } from '#mfe/shared-state'

function RoutedContent() {
  const store = useSharedStateStore()
  const router = useMemo(
    () =>
      createMemoryRouter([
        {
          path: '/',
          loader: () => store.get('display:units'),
          action: async () => {
            await store.set('display:units', 'imperial')
            return null
          },
        },
      ]),
    [store],
  )
  return <RouterProvider router={router} />
}
```

The framework app adapter still owns a TanStack Router boundary. React Router can consume the store wherever it is already hosted; this change does not replace the app adapter's routing contract. A widget owns no page URL, so use a memory router inside one.

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
  return store.get('well:active-selection')
}
```

Call injectors in an injection context: component/service field initializers, guards or resolvers. Capture the store before an await. Signal subscriptions end with the injection context; state remains owned by the shell across unmount/remount.

## Shell and backend configuration

```ts
const { runtime } = createMfeRuntime({
  // Existing shell options ...
  sharedState: {
    scope: opaqueTenantUserWorkspaceIdentity,
    catalog: canonicalManifest,
    supported: [supportedOlderManifest],
    adapter: durableBackendAdapter,
    onError: reportSharedStateFailure,
  },
})
```

The deployment chooses the canonical catalog and explicit support window. The first mounted app cannot choose them. Required hydration and revision checks finish before rendering or router creation. Missing records may materialize declared defaults, without persisting on mount. Invalid records fail hydration and retain their persisted data; recovery must be explicit.

The shell calls `runtime.sharedState.setScope(nextOpaqueIdentity)` and remounts affected surfaces when tenant, user or workspace changes. Old bindings become unusable, pending promises reject, subscriptions are removed, and late hydration/write responses cannot reach the new scope. Collaborative workspace state requires its own configured scope; it is not automatically shared between users.

`@company/mfe-runtime/shared-state` exports the structural protocol and `createSharedStateBackend`. Supply a `SharedStateRepository` with `read` and a **transactional, durable** `transact` operation, plus authenticated read/write authorization. The server resolves writer descriptors from its trusted registry, validates the current canonical record and the resulting value, stores an idempotency receipt, and returns the authoritative record. Its promise must resolve after commit. Map transport conflicts and cancellation to the protocol, and provide an optional subscription for authoritative records.

The write envelope carries scope, ID, writer contract revision, expected record revision, operation ID and value. A compare-and-swap conflict rejects and refreshes without retrying the stale user intention. Local queued intentions keep their original expected revisions, so a remote change cannot silently overwrite a newer record. Clients replay newer optimistic intentions over older authoritative responses; scope cancellation does not depend on the adapter honoring abort.

Test helpers deliberately use memory and make no persistence guarantee. Production has no public memory-persistence selection and no offline/queued-acceptance substitute for a durable setter result.

## Mixed-version writes

**Setting a concrete object replaces fields described by the writer's contract and preserves newer fields outside it.** Old strict schemas read a projected view before validation; reading never writes that view back.

| Operation                            | Result                                                         |
| ------------------------------------ | -------------------------------------------------------------- |
| Known scalar                         | Replace                                                        |
| Unknown omitted field                | Preserve                                                       |
| Known optional field omitted         | Remove                                                         |
| Known defaulted field omitted        | Materialize its deterministic default                          |
| Nested concrete object               | Replace known fields recursively; preserve unknown descendants |
| Explicit null at a nullable boundary | Clear that complete subtree, including newer descendants       |
| Omitted known optional object        | Remove that complete subtree                                   |
| Array                                | Replace atomically                                             |

New defaulted fields appear in the effective canonical view and persist on the next accepted write. Domain logic still owns dependent-field resets: preserving a comparison field while changing the well may preserve a semantically stale selection.

Run the executable two-MFE example after building:

```sh
node tools/shared-state/example.mjs
```

It compiles two strict schema revisions independently, demonstrates a newer field surviving an old writer, verifies projected reads, and then clears the full state. The backend repository in this example is test-only; connect your durable database for deployment.

## Contract packages, release checks and diagnostics

Supported syntax includes finite JSON primitives, primitive literals, string enums, fixed objects, nullable/optional properties, arrays, deterministic literal defaults, string/array length bounds, number bounds and safe integers. Transforms, coercion, arbitrary refinements, dynamic defaults, recursion, unions, records and unsupported methods fail closed. Put sharedStateSchema directly on literal definition options without spreads so its declaration can be removed reliably.

Local exported const schemas can refer to other local schema consts and relative modules. A published domain package exports its authoring schema for TypeScript and also exports `<package>/shared-state.manifest.json`:

```json
{ "schemas": { "sharedStateSchema": { "formatVersion": 1, "contracts": [] } } }
```

Populate contracts with `compileSharedState` from `@company/mfe-build/shared-state`; each artifact contains its validated shape and deterministic SHA-256 revision. Publish these artifacts immutably with the domain package. Source locations appear in compiler diagnostics and stay out of runtime payloads.

Production builds declaring state require `sharedStatePolicy: './deployment/shared-state-policy.json'` in their build options. The file contains `catalog`, `supported` and explicit `baselines` manifests. Empty baselines declare a first release; missing/unreadable policy is an error. Publishing CI must provide the trusted published baselines rather than allowing an app to rewrite its support history. `checkSharedStateRelease` and `compareContracts` expose the same checks for editor and publishing integrations. Lint suppression cannot bypass the production release gate.

Optional/defaulted additions within concrete objects are compatible. Required additions, removals/renames, type/default/constraint/enum/nullability changes and changes within atomic array elements fail automatic approval. A root ID addition does not invalidate other keys. Diagnostics include rule, ID, property path, old/new shape and a repair. Use a new key with an explicit bridge for breaking changes, or retire incompatible consumers through a coordinated rollout. Structural checking cannot establish whether an ID was reused for a different domain meaning.

Generated deployment output includes a lightweight shared-state index and one JSON artifact per required key/revision. Repeated revisions are deduplicated within a container. Bindings contain types and definition identity, not a catalog or compiler; production definitions contain references. The shell can load and cache artifacts by revision before constructing its catalog. Compiler, compatibility baselines and Zod authoring code introduced solely by this declaration stay out of the consumer runtime graph.

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
| one-app         |             230 | 242 / 214 / 190              | 257 / 191 / 156               |         1 |
| same-revision   |             463 | 487 / 233 / 187              | 257 / 191 / 156               |         1 |
| mixed-revisions |             496 | 484 / 280 / 233              | 584 / 254 / 217               |         2 |

The standalone shell store and validator bundle measures 10333 raw, 3694 gzip and 3283 Brotli bytes. These rows overlap with full framework package bundles and must not be summed with them. The inspected graphs contain no compiler, baseline history or Zod authoring modules. Generated payload tests verify one copy per revision per container.

Measured fixture budgets: at most 400 declaration bytes per app, one artifact per distinct revision per container, and zero retained authoring validators. The script enforces the declaration budget and graph exclusion. Timing is reported separately for in-process hydration, cached reads and projecting 10,000 items; it is machine/load-dependent and excludes network/database latency, so no universal timing budget is claimed.
