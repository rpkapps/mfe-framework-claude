# User-context protocol

User context is a shell-owned service for the signed-in user. Each App or Widget owns one object slice under its definition ID. Owners declare `userContext.schema`; readers declare `userContext.reads` keyed by owner ID. A definition can write only its own slice. An explicit-owner binding exposes only a reactive read.

## Authoring and generated bindings

Declare `userContext: { schema?, reads? }` on literal `createApp` or `createWidget` options. `schema` is the definition's owned Zod object; `reads` maps foreign definition IDs to the Zod subsets this consumer reads. Either property is optional. A reader subset names only the fields it uses, including just a nested property such as `selection.wellId`, without importing the owner's schema. Generated types hide undeclared fields, but runtime snapshots are not a field privacy boundary.

A reader parses the stored record with its own subset, so it sees only the owner's stored values, never the owner's defaults. Give every field the owner may not have written yet a default, or make it optional or nullable. A required field the owner has not written fails with `user-context/invalid-value`, and the message says how to fix it.

Generated `#mfe/user-context` bindings expose one primary binding per framework: React `useUserContext` or Angular `injectUserContext`. A container with multiple definitions uses `#mfe/user-context/<definition-id>`. The build copies each `userContext` declaration, with the imports and top-level constants it uses, into a generated `<definition-id>.declaration.ts` that the binding imports for its types only. TypeScript then infers the owner slice and each read subset exactly as Zod parses them; callers do not supply cross-owner generics, and an undeclared owner or key is a compile error.

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

Calling `useUserContext('operations', context => context.selection.wellId)` returns a readonly one-element tuple. Calling `injectUserContext('operations', context => context.selection.wellId)` returns only `{ value: Signal<T> }`. No setter is present in either the read-only type or the returned binding. The runtime checks that a mount writes only its own owner and reads only owners it declared. React router callbacks retain imperative access through `context.mfe.userContext`; Angular guards and resolvers can read a selected signal created once by a service provided within the mounted definition. The subscription lasts until that service's injection context is destroyed; a resolver callback returning does not dispose it.

## Validation

The runtime validates with the declared Zod schemas; there is no compiled contract. The owner's schema validates every record of that owner the page loads, and every write before it is sent. A reader's subset validates the foreign fields it reads. Each binding parses the stored record with its own schema, which also fills in that schema's defaults, and caches the result until the record changes.

Any Zod object schema works, including unions, records, refinements and transforms, as long as what it parses to is JSON: a transform to `Date` or `Map` is refused with `user-context/invalid-value`. Stored values must be JSON objects. The schema is called through its own methods (`safeParse`, `toJSONSchema`), so a container's schema is read by the Zod that made it, and the shell does not need to share Zod's runtime with the containers.

## Saving

`set(key, value)` returns a structured `MfeResult`: `{ ok: true, value }` after the server accepts the write, or `{ ok: false, error }`. Reads and subscriptions show only what the server accepted; there is no optimistic or pending value.

An object update for a key is completed from what the tab currently reads, so `set('selection', { run: 'two' })` keeps the other fields of `selection`. The whole key is then sent. An owner's writes go out one at a time, in the order they were made, each as `{ id, value: { [key]: value } }`. The server replaces that key in the stored record, leaves the other keys as they were and bumps the record's revision. The last write of a key wins; there is no compare-and-swap, so two tabs editing the same key do not conflict, and the later save is kept.

The client keeps a record only when its revision is newer than the one it holds, so a late response or a duplicate synchronization event cannot move the value back. A failed write rejects only that `set`, reports the error through `onError`, and reads that owner again, because the server may now hold something this tab has not seen.

Error codes are `unauthorized-owner`, `invalid-value`, `undeclared`, `not-ready`, `scope-disposed` and `persistence-failed`, each prefixed with `user-context/`.

## Transport

`@company/mfe-core/user-context` exports the reader, store, adapter and inspection types and the JSON helpers. It imports Zod's types only and has no dependency on React, Angular or build tools.

The shell's `UserContextAdapter`, exported by the React and Angular `/host` entries, hydrates records with `hydrate(ownerIds, signal)`, writes with `write({ id, value }, signal)`, and can `subscribe(listener, signal)` to records changed elsewhere. It never receives or sends a user scope: the authenticated API derives the user from the request. Hydration returns one `{ id, revision, value? }` record per requested owner, with revision `0` and no value when the owner has never written. A write resolves with the stored record and its new revision.

`@company/mfe-runtime/user-context` provides `UserContextRuntime` and `createUserContextBackend({ repository, resolveOwner, authorize })` for the server. The backend takes the user's scope per call, `backend.hydrate(scope, ids, signal)` and `backend.write(scope, write, signal)`, from the server's own authenticated request. It has no schema configuration: a user's persisted document is an owner map such as `{ lab: { units: "metric" }, shell: { preferences: { theme: "dark" } } }`, with each owner's revision beside it. The required `resolveOwner` callback derives the writer from the trusted request independently of the submitted owner ID. Authorization remains the server's responsibility: the runtime's ownership checks keep cooperating definitions apart, not arbitrary script. In tests, `scopedUserContextAdapter(backend, scope)` from the `/testing` entries binds a backend to one user as a browser adapter.

## Shell and lifecycle

The shell uses the normal `createMfeRuntime` from its framework's `/host` entry and supplies `userContext: { adapter, schema?, reads?, onError? }`. Its own slice is owned under the ID `shell`, and its foreign reads live beside the adapter in that factory call. The build generates the typed `#mfe/user-context` hook from the copied declaration, never another runtime factory. Preparation (hydrating the owner and every declared foreign owner) finishes before a definition renders or runs route callbacks. A definition without `userContext` mounts without touching the service, including while nobody is signed in.

While no user is signed in, the runtime performs no context storage operations: preparing or binding fails with `user-context/not-ready`. When the signed-in user changes through `runtime.shellState.apply({ user })`, the store resets: it drops every record, and every binding, request and subscription of the previous user fails closed with `user-context/scope-disposed` through the generation and abort signal it captured. The shell remounts what it shows, so an old mount never reads the next user's data. `dispose` aborts work and removes subscriptions.

The shell theme can come from the shell's own slice with `createMfeRuntime({ theme: { select, cacheKey } })`. The startup cache stays partitioned per tenant, account and user, so a prepaint bootstrap never applies another user's preference.

Read-only inspection lists each owner the page has loaded with its status (`hydrating`, `ready` or `invalid`), record revision, stored value, the owner's schema as JSON Schema when the page knows it, and the error that made it invalid. Observing inspection never hydrates or writes, and it never exposes the user's scope.

See the React and Angular walkthrough in `examples/user-context/README.md` and the consumer guide at `/docs/user-context` for application examples.
