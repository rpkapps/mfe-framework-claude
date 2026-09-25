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

| On `runtime`  | What it is                                                                 |
| ------------- | -------------------------------------------------------------------------- |
| `registry`    | the accepted entries by id, and the rejected ones with their reasons       |
| `loader`      | the shared loader, with each adapter's `aroundLoad` applied                |
| `shellState`  | user, groups and theme, with the session transitions that retire user data |
| `storage`     | validated storage, scoped by definition id, with `@host` for the page      |
| `actions`     | the action registry the palette and the key listener read                  |
| `breadcrumbs` | the breadcrumb store the header reads                                      |
| `navigator`   | the `BoundaryNavigator` over the navigation bridge                         |
| `diagnostics` | the hub every framework failure reaches                                    |
| `deadlines`   | the budget every mount runs under                                          |

`actions.execute(id, { caller })` runs an action for whoever asked: `'palette'`,
`'shortcut'`, `'ui'` or `'agent'`. Every caller goes through the same steps in
`action-executor.ts` — `canExecute` decides, then `execute` runs — and gets back
`executed` with the `value` `execute` returned, `denied` with the reason,
`unavailable` when the action is gone, or `failed`. A denial reaches
`notifyActionDenial` only when a user asked; an agent hears the reason in the
result.

A host listens for `keydown` once and calls `actions.handleKeyDown(event)`,
which runs the action whose `shortcut` the keys complete. The host page's
shortcuts fire everywhere and are reserved; an App's fire while the navigator's
pathname is inside its boundary; a Widget's are ignored. A key two live
registrations claim runs neither, and the collision was already reported when
the second was declared. `parseShortcut` is the same reading, for a host that
draws or checks one.

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
