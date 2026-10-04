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

## Author guides and API reference

Use the task guides for complete examples and the reference for exact contracts:

| Task                              | Canonical documentation                                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Declare an App or Widget          | [Create an App](../../apps/docs/content/docs/create-an-app.mdx), [Create a Widget](../../apps/docs/content/docs/create-a-widget.mdx), [factory reference](../../apps/docs/content/docs/reference/create-app-and-create-widget.mdx)   |
| Place a definition                | [Render a Widget](../../apps/docs/content/docs/render-a-widget.mdx), [embed an App](../../apps/docs/content/docs/embed-another-app.mdx), [host component reference](../../apps/docs/content/docs/reference/hooks-and-components.mdx) |
| Read shell services               | [Hooks and components](../../apps/docs/content/docs/reference/hooks-and-components.mdx)                                                                                                                                              |
| Register actions or agent context | [Add an action](../../apps/docs/content/docs/add-an-action.mdx), [tell the agent what is selected](../../apps/docs/content/docs/tell-the-agent-what-is-selected.mdx)                                                                 |
| Test a definition                 | [Testing API](../../apps/docs/content/docs/reference/testing-api.mdx)                                                                                                                                                                |

The site serves these guides under `/docs` when you run `pnpm docs:dev` from the repository root.

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

The App router factory runs again when a user signs in or out, or the user, account, tenant
or groups change. Each App and Widget gets a fresh Query client and resets its
component state; an App also gets a fresh router. Active queries reload, and
route callbacks read the current shell state. Work still finishing with the old
client cannot fill the new client's cache. Stored values remain. A theme or
display-name change, token refresh, or reordered group list leaves the client
and view state alone. Clear any user-dependent cache you keep outside the mount
yourself.

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
its `aroundLoad` hides TanStack Router's development global until every overlapping React
container load finishes, remembering routers published during those loads for restoration
afterwards. `apps/shell/src/boot.tsx` is the worked example.

## Calling services from the shell

Shell-state, storage, action, agent-context and breadcrumb hooks also work outside a mount,
in the reserved `@host` scope, given an `MfeProvider` above them.
Mount-only hooks require a definition's provider context.
[Where each hook may be called](../../apps/docs/content/docs/reference/hooks-and-components.mdx#where-each-hook-may-be-called)
is the authoritative scope table.

Local and session values survive sign-out and belong to the browser profile. Keep nothing personal
in them; personal values belong in `storage: 'user'`.
[Remember a value](../../apps/docs/content/docs/remember-a-value.mdx) explains validation, scope and updates.

## Building a container

A React container builds with `pluginMfe()` from `@company/mfe-rspack`, which
composes the framework-neutral `@company/mfe-build`. `pnpm create @company/mfe`
scaffolds one.

```sh
pnpm vitest run --project react
pnpm --filter @company/mfe-react typecheck
```
