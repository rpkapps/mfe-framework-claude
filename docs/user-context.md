# User-context protocol

User context is a shell-owned service for the current authenticated scope. Each App or Widget owns one object slice under its definition ID. Owners declare `userContext.schema`; readers declare `userContext.reads` keyed by owner ID. A definition can write only its own slice. An explicit-owner binding exposes only a reactive read.

## Authoring and generated bindings

Declare `userContext: { schema?, reads? }` on literal `createApp` or `createWidget` options. `schema` is the definition’s owned Zod object; `reads` maps foreign definition IDs to the Zod subsets this consumer requires. Either property is optional. Reader subsets can omit owner defaults and object strictness, including within nested objects, while retaining nullable/optional semantics, types and constraints. Arrays remain atomic contracts with complete item shapes. Generated types hide undeclared fields, but runtime snapshots are not a field privacy boundary. A read-only Widget can declare only `reads`, including just a nested property such as `selection.wellId`, without importing the owner’s schema. Local exported schemas and supported relative imports can be compiled. Independently published schemas are optional conveniences, not required infrastructure.

The build compiles one contract for the owner's whole object slice, plus reader requirements for explicitly declared owners. The contract ID is the definition ID; its properties are local context keys. Generated `#mfe/user-context` bindings expose one primary binding per framework: React `useUserContext` or Angular `injectUserContext`. A container with multiple definitions uses `#mfe/user-context/<definition-id>`. Generated types infer the owner slice and each declared read schema; callers do not supply cross-owner generics.

```ts
// React: selected value and stable owner-only setter.
const [wellId, set] = useUserContext(context => context.selection.wellId)
const result = await set('selection', { wellId: 'well-42' })
if (!result.ok) reportFailure(result.error)
```

```ts
// Angular: a selected-value signal and owner-only setter.
readonly selection = injectUserContext(context => context.selection.wellId)
// Read with this.selection.value(); write with this.selection.set('selection', patch).
```

Selectors must be pure and synchronous: read nested properties or derive a value without mutating the JSON context. Return strings, numbers, booleans, `null`, `undefined`, plain objects or arrays; returned data is immutable. Functions, class instances such as `Map` or `Date`, promises and cyclic results are unsupported. Subscriptions track the paths the selector reads; unrelated sibling changes do not update the consumer. Replacing a parent object updates a nested selection when its selected value changes. React manages cleanup through the hook lifecycle; Angular attaches cleanup to its injection context. Application code does not manage unsubscribe functions.

Calling `useUserContext('operations', context => context.selection.wellId)` returns a readonly one-element tuple. Calling `injectUserContext('operations', context => context.selection.wellId)` returns only `{ value: Signal<T> }`. Both use the declared cross-owner read contract. No setter is present in either the read-only type or the returned binding. The runtime independently checks the mounted definition identity and declared read requirements. React router callbacks retain imperative access through `context.mfe.userContext`; Angular guards and resolvers can read a selected signal created once by a service provided within the mounted definition. The subscription lasts until that service's injection context is destroyed; a resolver callback returning does not dispose it.

## Commit behavior

`set` returns a structured `MfeResult`: `{ ok: true, value }` after durable acceptance or `{ ok: false, error }` for a failure. Invalid updates, write conflicts, storage failures and scope disposal leave the committed value intact. Pending writes are visible only through diagnostics, not through reads or value subscriptions.

Successful commits update the owner snapshot before notifying subscribers. Subscriptions observe committed changes and unsubscribe on mount or scope disposal. Read snapshots remain stable while no committed data changes.

Object updates merge recursively. Omitted fields are retained, including fields unknown to an older writer. Arrays are atomic replacements. `null` is an explicit value and requires a nullable field. The MFE runtime validates the complete merged owner slice against its generated contract. The backend validates only the JSON/envelope shape, authorization and concurrency; it never imports domain schemas or fills application defaults.

## Structural transport

`@company/mfe-core/user-context` exports JSON-only contracts, requirements, readers, stores, adapters and inspection types. It has no dependency on React, Angular, Zod or build tools.

A compiled `StateContract` contains `formatVersion`, owner `id`, deterministic schema `revision` and a structural `node`. `UserContextManifest` contains contracts. `UserContextRequirements` carries protocol version, the mounted owner ID and required contract capability signatures. Contract revisions identify schema shape; monotonically increasing record revisions identify saved data. They are different revision domains.

The shell's `UserContextAdapter`, exported by the React and Angular `/host` entries, hydrates records with `hydrate(ownerIds, signal)`, writes owner updates with `write(operation, signal)`, and can `subscribe(listener, signal)`. It does not receive or send scope strings. The authenticated API derives the user independently; the low-level repository can partition records internally. Each write contains an expected record revision and idempotency operation ID. The server must authenticate access, apply revision checks and merge opaque JSON in a transaction, and acknowledge only after commit. Late or duplicate authoritative events cannot replace a newer record.

`@company/mfe-runtime/user-context` provides `UserContextRuntime` and `createUserContextBackend`. A backend repository supplies reads and durable transactions through `createUserContextBackend({ repository, resolveOwner, authorize })`. There is no schema configuration. A user’s persisted document is an owner map such as `{ lab: { units: "metric" }, shell: { preferences: { theme: "dark" } } }`; owner revisions and idempotency receipts are companion metadata. Updating one owner preserves other owners and unknown fields. The required `resolveOwner` callback derives the writer identity from the trusted server request independently of submitted owner and scope fields. Authorization remains the server's responsibility: browser ownership checks provide capability isolation between cooperating definitions, not a security boundary against arbitrary script execution.

## Shell and lifecycle

The shell uses the normal `createMfeRuntime` from its framework’s `/host` entry and supplies `userContext: { adapter, schema?, reads?, onError? }`. Its own schema and any used foreign read requirements live beside the local adapter in that factory call. The build generates typed hook bindings and private metadata, never another runtime factory. Compiled owner contracts are registered automatically from the generated registry's embedded contracts; the host does not manually aggregate them or fetch separate artifacts. Hydration and capability validation finish before a definition renders or runs route callbacks. A reader can consume a compatible subset of a newer owner contract. Persistence receives opaque JSON and transport metadata; compiled owner contracts are never imported by the adapter or backend.

The runtime derives each scope from the shell user's tenant ID, account ID and user ID. While no user is signed in, it performs no context storage operations. Updating identity through `runtime.shellState.apply({ user, groups })` invalidates old bindings and pending work; the shell remounts affected definitions. Old hydration, storage acknowledgements and subscription callbacks cannot enter the new scope. `dispose` aborts work and removes subscriptions. Applications do not construct scope strings or call a separate scope setter.

Optional read-only inspection exposes owner contracts, committed values, status, record revisions and pending counts. Observing inspection never hydrates or writes. Inspection excludes authenticated scope values.

## Build and release

Supported schemas are finite JSON shapes: fixed objects, primitives, literals, enums, arrays, nullable/optional properties, deterministic defaults and supported bounds. Unsupported transforms, coercion, dynamic defaults, arbitrary refinements, recursion, unions and records fail closed.

Build output contains owner contract artifacts and lightweight references. The transform removes the authoring `userContext` declaration and attaches compiled requirements as private `__userContext` metadata; application authors never write that field. Production definitions and generated bindings exclude authoring Zod schemas, compiler code and historical compatibility payloads introduced solely by context declarations.

Normal builds require no baseline map. An owner may call `compareContracts(previous, candidate)` from `@company/mfe-build/user-context` in its standalone release tooling. That optional comparison is independent of deployment, shell integration and persistence; none maintains a list of owner versions or historical contracts.

See the React and Angular walkthrough in `examples/user-context/README.md` and the consumer guide at `/docs/user-context` for application examples.
