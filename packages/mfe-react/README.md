# `@company/mfe-react`

The React adapter. A React container uses it to declare its App or Widget, to
read the shell's services from inside a mount, and to place other definitions;
a React shell boots from it. It depends only on the neutral `@company/mfe-core`
and `@company/mfe-runtime`, never on another adapter.

An application imports this package alone — its root, `/host`, `/registry` or
`/testing` — and never the core or the runtime directly. Lint enforces that.

| Entry point                   | Holds                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `@company/mfe-react`          | `createApp`, `createWidget`, `AppHost`, `mfeRoute`, `lazyWidget`, `DynamicWidget`, the hooks |
| `@company/mfe-react/host`     | `export * from '@company/mfe-runtime'`, plus `MfeProvider`: what a React shell boots from    |
| `@company/mfe-react/registry` | `reactAdapter` alone, with no React import                                                   |
| `@company/mfe-react/testing`  | `renderApp`, `renderWidget`, `mountApp`, `mountWidget` and the runtime's test fakes          |

`/testing/mfe-config` and `/testing/mfe-fetch` stand in for a container's
generated `#mfe/config` and `#mfe/fetch` in its tests.

## An App, a Widget, and placing them

```ts
// src/mfe.ts
export default createApp({ id: 'operations', version: '2.1.0', router: makeRouter })
```

The App owns its router. `makeRouter({ basePath, history, context })` passes
`basePath` to `createRouter({ basepath })` and the supplied `history` and
`context` through unchanged; the first render checks all three and rejects the
mount, naming the repair, when one is not what it supplied.

```tsx
export const alertPanel = createWidget({
  id: 'alert-panel',
  ...alertPanelContract,
  render: AlertPanel,
})

const Panel = lazyWidget('alert-panel', { contract: alertPanelContract }) // at module scope
;<Panel alertId={id} onAcknowledged={ack} pending={<Skeleton />} fallback={Failed} />
```

`AppHost`, `mfeRoute`, `DynamicWidget` and the component `lazyWidget` returns
render an empty element and hand it to the runtime's `mountDefinition`. They
never ask which framework built the definition, so they place Angular
definitions exactly as they place React ones.

- **Nothing suspends.** `pending` fills the region while the container loads and
  the definition mounts; `fallback({ error, retry })` replaces it after a
  failure. Without a `fallback`, the failure is thrown to the nearest error
  boundary.
- **`retry()` acts only after a failure**, and a failed load is loaded afresh.
- **A Widget is handed only inputs that changed**, and outputs reach the `onX`
  prop their name maps to, then `onOutput`, with or without a contract.
- **Under StrictMode** the effect disposes the first mount before its load
  settles, so a definition's `mount` runs once.
- **`mfeRoute({ appId })`** delegates a splat route to another App and calls
  `navigator.announce()` when its router's location changes.

## Each definition in a React root of its own

A React definition's `mount` opens a React root on the element the runtime gives
it, inside the runtime's scope root. The root renders the mount's providers, its
own Query client, the style root the container's build attached, and then the
App's router or the Widget. It never adds a scope root of its own.

- `useId` values are prefixed with the mount token, so two roots never collide.
- In development the root runs in `StrictMode`.
- A render failure before the first commit rejects the mount. One after it goes
  to `target.onFailure`, which moves the mount to its error state. Recoverable
  errors go to diagnostics.

So several React versions can share a page, and React context, Suspense and a
host's error boundaries do not reach into a mounted definition. A container on
another React version brings its own `sonner`, so its toasts do not reach the
shell's `Toaster`.

## Booting a shell

```tsx
import { angularAdapter } from '@company/mfe-angular/registry'
import {
  createFederationContainerLoader,
  createMfeRuntime,
  MfeProvider,
} from '@company/mfe-react/host'
import { reactAdapter } from '@company/mfe-react/registry'

const { runtime } = createMfeRuntime({
  registryEntries,
  adapters: [reactAdapter, angularAdapter],
  loader: createFederationContainerLoader({ runtime: { registerRemotes, loadRemote } }),
  shellState,
  telemetryProvider,
})

root.render(
  <MfeProvider runtime={runtime}>
    <App />
  </MfeProvider>,
)
```

The shell lists every adapter; none is registered implicitly. `reactAdapter`
recognises an entry whose `mfe` marker names `react`, and
its `aroundLoad` hides TanStack Router's development global while a React
container evaluates. `apps/shell/src/boot.tsx` is the worked example.

## Hooks

| Hook                                                | Gives                                                     |
| --------------------------------------------------- | --------------------------------------------------------- |
| `useUser()`, `useGroups()`, `useTheme()`            | one shell-state field each                                |
| `useStoredState(name, schema, options)`             | validated state under the definition's storage scope      |
| `useMfeStorage()`                                   | the imperative storage handle                             |
| `useAction(registration)`                           | an action for the palette and the agent, and its run      |
| `useAgentContext(registration)`                     | a snapshot of what is selected, sent with each agent turn |
| `useAgentPrompt()`                                  | a function that hands a click to the shell's chat         |
| `useAgentSuggestions(suggestions)`                  | prompts the chat offers while the component is mounted    |
| `useBreadcrumbs(items)`                             | overrides the App's own breadcrumbs                       |
| `useNavigationBlock(shouldBlock)`                   | a block for a mount with no router                        |
| `useTelemetry()`, `useMfeSignal()`                  | the mount's telemetry and its disposal signal             |
| `useBasePath()`, `useScopeRoot()`                   | the boundary, and the runtime's scope root for the mount  |
| `useRegistryEntries()`, `useApps()`, `useWidgets()` | registry views for a host                                 |

Shell-state, storage, action, agent-context and breadcrumb hooks also work outside a mount,
in the reserved `@host` scope, given an `MfeProvider` above them.

`useAction` publishes an action to the palette and, unless its `placements` say
otherwise, to the shell's agent as a tool. `description` is written for the
agent, while `label` stays the menu text. `inputSchema` is one `z.object`,
declared at module scope, that every call's input is parsed with before
`execute` receives it; `outputSchema` checks the value `execute` returns.
`effect` is `'read'`, `'write'` or `'destructive'`, and an undeclared one counts
as `'write'`, so the agent asks the user before each call. `needsApproval`,
`parallelSafe` and `followUp` tune the agent's calls further.

It returns a stable `ActionRun` with the caller `'ui'`, for the App's own
button: a click shares `canExecute`, validation and the denial notice with the
palette, the keys and the agent. The input is optional when the schema accepts
`{}`. It runs this component's registration, even when another mount of the
definition registered the same name, never rejects, and resolves `unavailable`
after the component unmounts. The package
exports `ActionEffect`, `ActionInputSchema`, `ActionRun` and
`ActionExecutionResult` as types.

```tsx
const simulationInput = z.object({ runs: z.number().int().min(1).max(1000).default(100) })

const runSimulation = useAction({
  name: 'run-simulation',
  label: 'Run the simulation',
  description: 'Runs the well-planning simulation. More runs take longer and smooth the result.',
  inputSchema: simulationInput,
  effect: 'read',
  execute: ({ runs }) => simulate(runs),
})

return <Button onPress={() => void runSimulation({ runs: 10 })}>Run 10 times</Button>
```

An action can carry a `shortcut`: a chord such as `'mod+s'` or a sequence such
as `'g r'`, where `mod` is ⌘ on a Mac and Ctrl elsewhere. `useAction` passes it
through unchanged; the host reads every key once and runs the action through
the palette's path, so `canExecute` still decides. An App's shortcut fires while
the page is inside the App's boundary. A Widget's is ignored, and so is one the
host page already uses, each with a diagnostic.

```tsx
useAction({
  name: 'open-wells',
  label: 'Operations: open the wells inventory',
  effect: 'read',
  shortcut: 'o w',
  execute: () => void navigate({ to: '/wells' }),
})
```

`useAgentContext({ description, schema, value })` publishes a small, typed
snapshot of what is selected or open, which the shell's agent receives with each
turn. `description` tells the model what the value is, and the agent receives
what `schema` parsed: ids and a short label, JSON of at most 4096 characters,
never whole records and never secrets. The agent reads records through the
App's read actions. Call it on every render; an equal value publishes nothing.
An invalid value is left out and reported once as a warning. The snapshot goes
when the component unmounts or the mount is disposed. The URL goes with each
turn without a hook, so a filter the agent should see belongs in search params.

`useAgentPrompt()` returns a stable function that hands
`{ message, context?, submit? }` to the shell's chat: `message` is shown,
`context` is sent unseen, and `submit: false` fills the input box for the user
to review. It returns whether a chat took the prompt; `false` when the shell has
no chat. `useAgentSuggestions([...])` offers up to three such prompts, which the
chat shows as chips before the first message and after each answer, until the
component unmounts. The package exports `AgentContextEntry`,
`AgentContextRegistration`, `AgentPrompt` and `AgentSuggestion` as types.

```tsx
const openWell = z.object({ id: z.string(), name: z.string() }).nullable()

useAgentContext({
  description: 'The well design the user has open, or null when its id is unknown',
  schema: openWell,
  value: design === undefined ? null : { id: design.id, name: design.name },
})

const prompt = useAgentPrompt()
```

## Building a container

A React container builds with `pluginMfe()` from `@company/mfe-rspack`, which
composes the framework-neutral `@company/mfe-build`. `pnpm create @company/mfe`
scaffolds one.

```sh
pnpm vitest run --project react
pnpm --filter @company/mfe-react typecheck
```
