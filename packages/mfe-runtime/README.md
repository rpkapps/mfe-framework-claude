# `@company/mfe-runtime`

The runtime every host and every definition on a page shares. It reads the
registry through the adapters a shell lists, loads containers, mounts every
definition through one path, and owns the page's services: shell state,
validated storage, actions, breadcrumbs, the navigation bridge, auth, telemetry
and diagnostics. It imports no React, Angular, router, single-spa or Module
Federation, and depends on `@company/mfe-core` alone, which holds the contracts.

No application imports it. A shell reaches it through its adapter's `/host`,
which is `export * from '@company/mfe-runtime'` plus that framework's provider,
and a test through the adapter's `/testing`. Lint rejects a direct import.

## One runtime per page

```ts
const { runtime, activeOverrides, dispose } = createMfeRuntime({
  registryEntries, // the raw registry.json array
  adapters: [reactAdapter, angularAdapter], // every adapter; none is implicit
  loader: createFederationContainerLoader({ runtime: { registerRemotes, loadRemote } }),
  shellState: { user, groups, theme },
  telemetryProvider,
  diagnostics, // an existing hub, so installShellAuth could report before this
  deadlines: { load: 60_000 }, // merged over DEFAULT_DEADLINES
})
```

`readRegistry` offers every raw entry to every adapter's `detect`, and exactly
one must recognise it. None and the entry is rejected as unrecognised; more than
one and it is rejected as ambiguous, with both named. Order means nothing. A
rejected entry loses only itself and reaches the diagnostics hub.

An adapter plugs in load behaviour through `MfeAdapter.aroundLoad(load, entry)`.
The runtime runs it inside the shared loader, once per load that actually
happens and only for entries that adapter parsed. `parseFederatedEntry` is the
one reading of the entry shape every framework build publishes, so each
framework adapter keeps only its `detect` and its `kind`.

## One mount path

```ts
const mount = mountDefinition({
  runtime,
  element, // rendered and left childless by the host
  definitionId: 'alert-panel',
  kind: 'widget',
  inputs: { alertId: 'a-42' },
  onOutput: (name, payload) => handle(name, payload),
  parent, // the enclosing MountContext, if any
})
mount.subscribe(() => render(mount.getState()))
mount.update(nextInputs)
await mount.dispose()
```

Every host places every definition this way, whichever framework built it, its
own included. The runtime:

- resolves the definition through the loader, which shares a load in flight and
  keeps one that resolved, and never keeps a rejection;
- checks it is a mountable definition of the kind the registry named;
- creates the scope root (`data-mfe-scope`, `data-mfe-mount`, `data-mfe-kind`,
  `display: contents`) with the definition's element inside it, and the
  body-level overlay root, and hands both on in the `MountContext`;
- calls `definition.mount(target)` after an `await`, never from inside a host's
  render;
- drops an input set shallow-equal to the last, and delivers inputs that
  changed while the mount was pending once, afterwards;
- reports an output the host's own contract refuses, rather than throwing it;
- retries only from the error state, disposes a nested mount with its parent,
  and tears down the definition before its context.

Load, mount and disposal run under `runtime.deadlines`: 30, 30 and 5 seconds
unless the shell tunes them. The state is core's `MountState`: `pending`,
`mounted`, `error` or `disposed`.

A definition renders into `target.element`, portals into
`context.overlayRoot`, and never adds a root of its own. A failure after its
mount resolved goes to `target.onFailure`, which moves the mount to `error`.

## Federation and share scopes

`createFederationContainerLoader({ runtime })` is handed the federation runtime
rather than importing it. It registers each container once, with the share
scopes its registry entry lists as `shareScopes` — `default` first, where
`@company/mfe-core` and this package are page singletons, then its framework's
scope, such as `react@19.3.0`. A remote links only the scopes it is registered
with, so an entry without `shareScopes` shares in `default` alone.

## The page's services

| On `runtime`   | What it is                                                                 |
| -------------- | -------------------------------------------------------------------------- |
| `registry`     | the accepted entries by id, and the rejected ones with their reasons       |
| `loader`       | the shared loader, with each adapter's `aroundLoad` applied                |
| `shellState`   | user, groups and theme, with the session transitions that retire user data |
| `storage`      | validated storage, scoped by definition id, with `@host` for the page      |
| `actions`      | the action registry the palette and the key listener read                  |
| `breadcrumbs`  | the breadcrumb store the header reads                                      |
| `agentContext` | what the agent is told with each turn: the URL, the Apps, the selections   |
| `navigator`    | the `BoundaryNavigator` over the navigation bridge                         |
| `diagnostics`  | the hub every framework failure reaches                                    |
| `deadlines`    | the budget every mount runs under                                          |

`actions.execute(id, { caller, input, turn })` runs an action for whoever asked:
`'palette'`, `'shortcut'`, `'ui'`, `'agent'`, or `'system'` for the host's own
code. Every caller goes through the
same steps in `action-executor.ts`: `canExecute` decides, the input is parsed
with the action's `inputSchema` (absent input is `{}`), and `execute` runs with
the parsed value. The result is one of these:

| Status        | When                                                                                    |
| ------------- | --------------------------------------------------------------------------------------- |
| `executed`    | `execute` ran; `value` is its return, parsed by `outputSchema` if any                   |
| `denied`      | `canExecute`, the placements or the policy refused, or nothing could ask; with `reason` |
| `declined`    | the user was asked about an agent's call and said no                                    |
| `invalid`     | the input failed `inputSchema` (`contract/input-mismatch`); nothing ran                 |
| `unavailable` | the action is gone, or its mount went while an agent's call waited                      |
| `failed`      | `execute` threw, or its value failed `outputSchema` (`contract/output-mismatch`)        |

The promise never rejects: a host hook or a schema's own check that throws fails
the run (`mount/failure`), and the run is audited like any other.

`register` returns an `ActionRegistrationHandle`: `update(registration)` after
each commit, validated as `register` is, `remove()`, `qualifiedId`, and
`execute(call)`, which runs this registration and no other. Two mounts of one
definition may each register a name: the first is `<definitionId>:<name>`, the
second `<definitionId>:<name>-2`, then `-3`, so running by id reaches the mount
the id names. Once removed, the handle's run is `unavailable`.

A denial reaches `notifyActionDenial` only when a user asked; an agent hears the
reason in the result, and the host's own code reads it there.

An agent's call takes two more steps. An action not placed for `'agent'` is
denied. Then approval: a `'read'` runs, anything else asks, unless the action's
`needsApproval` says otherwise. The host's `actionApprovalPolicy` sees each call
with that declared ruling and may return `'approve'`, `'ask'`,
`{ deny: reason }`, or `undefined` to keep it; a policy that throws denies.
Asking goes to the approver set
with `actions.setApprover(fn)`, the chat's card, which resolves whether the user
approved; with none set, the call is denied rather than run. An agent's writes
then run one at a time unless `parallelSafe`, and a call that waited is looked at
again first: a mount that went away returns `unavailable`, and a placement or a
`canExecute` that changed denies. A user who runs an action is its approval, so the palette,
a shortcut and the App's own UI never ask and never queue.

```ts
const { runtime } = createMfeRuntime({
  // …
  notifyActionDenial: notice => toast.warning(notice.label, { description: notice.reason }),
  // `undefined` keeps what the action declared.
  actionApprovalPolicy: request =>
    request.effect === 'destructive' ? { deny: 'Ask a person to do this.' } : undefined,
})

// `confirmInChat` is the host's own: it resolves true when the user approves.
const removeApprover = runtime.actions.setApprover(request => confirmInChat(request))
```

Every run is audited, whatever its outcome, a call to an action that is gone
included. The record (`ActionAuditRecord`) says who acted (`actor`: `'user'`,
`'agent'` on the user's behalf, or `'system'`), the `caller`, the signed-in
`userId`, the chat `turn` an agent's call passed, the `outcome` with its
`reason` or `errorCode`, the `input` with credentials redacted (`redactInput`:
values under keys such as `password`, `apiKey` or `token`, and any string that
is a bearer or basic header of one token, a JWT or a private key), `startedAt` and `durationMs`. The
runtime reports it to the telemetry provider as a `framework` record, operation
`run action`, at `info` when it ran and `warn` otherwise, and hands it to the
host's `auditAction`, whose backend stores it:

```ts
const { runtime } = createMfeRuntime({
  // …
  // `sendToAuditLog` is the host's own: it queues the record for its backend.
  auditAction: record => sendToAuditLog(record),
})
```

Each `ActionEntry` in `actions.getSnapshot()` carries what an agent's tool list
needs: `description`, `effect` (undeclared is `'write'`), `followUp`,
`placements` (absent is `['palette', 'agent']`), and `inputSchema` and
`outputSchema` as JSON Schema. The registry converts a schema with its own
`toJSONSchema` only when the schema's identity changes, and refuses one JSON
Schema cannot express at registration. `actionEntryEqual` compares all of them,
so a changed description is published and a closure's new identity is not.

A host listens for `keydown` once and calls `actions.handleKeyDown(event)`,
which runs the action whose `shortcut` the keys complete. The host page's
shortcuts fire everywhere and are reserved; an App's fire while the navigator's
pathname is inside its boundary; a Widget's are ignored. A key two live
registrations claim runs neither, and the collision was already reported when
the second was declared. `parseShortcut` is the same reading, for a host that
draws or checks one.

`agentContext` is the `AgentContextStore`: what the shell's chat sends with
each turn. `read()` returns `{ url: { pathname, search }, apps, selections }` at
the moment it is called. `apps` lists every mounted App whose boundary holds the
page, outermost first, each with `definitionId`, `basePath` and its own `path`
below it; the mount context calls `trackBoundary` for every App it creates, so
no author writes anything for the URL layer. `selections` are the snapshots
mounts publish with `register(owner, registration)`, or the host page with
`registerHost(registration)`, and `getSnapshot`/`subscribe` expose them alone.
A value is parsed by its schema and must be JSON of at most
`MAX_AGENT_CONTEXT_LENGTH` (4096) characters; one that is not is left out and
reported once as a `contract/input-mismatch` warning. An empty description
throws that code at registration; an update that empties it is left out and
reported the same way. An equal value publishes nothing, and `capturedAt` moves only
when the value changes. `removeMount(token)` takes a mount's selections,
suggestions and boundary with it; a mount's disposal calls it.

Suggestions are the prompts a mount offers as ways to start or carry on the
conversation, which the chat shows as chips while the mount lives.
`suggest(owner, suggestions)` offers a mount's, and `suggestHost(suggestions)`
the host page's; each returns an `AgentSuggestionsHandle` whose `update`
replaces the list and whose `remove` withdraws it. An `AgentSuggestion` is a
prompt with an optional `label` for the chip. At most three per owner are kept;
one with an empty message or a `context` that is not JSON of at most
`MAX_AGENT_CONTEXT_LENGTH` characters is left out, and what was left out is
reported once as a `contract/input-mismatch` warning. `getSuggestions()`
returns every owner's, in registration order, each an `AgentSuggestionEntry`
with its `definitionId`, `submit` settled and a copy of its `context`, and
`subscribeSuggestions` follows them; an equal list publishes nothing.

`prompt(prompt, definitionId?)` hands `{ message, context?, submit? }` to the
chat set with `setPromptHandler(handler)`, with `submit` settled to `true` when
absent, and returns whether a chat took it. With no handler it returns `false`;
the unsubscribe `setPromptHandler` returns removes only that handler. The store
exports `AgentAppLocation`, `AgentContextHandle`, `AgentContextOwner`,
`AgentContextStoreOptions`, `AgentPromptHandler`, `AgentPromptRequest`,
`AgentSuggestionsHandle` and `AgentTurnContext` as types.

```ts
// The chat, when it sends a turn.
const turn = runtime.agentContext.read()

// The chat, to receive a click from a mount.
const removePromptHandler = runtime.agentContext.setPromptHandler(request =>
  request.submit ? sendTurn(request) : fillComposer(request),
)

// The host page, offering a way in; the chat renders `getSuggestions()` as chips.
const suggestions = runtime.agentContext.suggestHost([
  { message: 'What changed since yesterday?', label: 'Recent changes' },
])
```

The browser bridge hears only `popstate`. A host whose own router writes the
page's history calls `navigator.announce()` after each navigation, and mounted
Apps hear where the page went; it emits nothing when they already know.

## Testing

`@company/mfe-runtime/testing` holds `createMemoryRuntime`, which reads
`adapters` and `registryEntries` as a shell does, the in-process loader, the
memory navigation bridge and storage, and the recording telemetry provider. Each
adapter's `/testing` re-exports it.

```sh
pnpm vitest run --project runtime
pnpm --filter @company/mfe-runtime typecheck
```
