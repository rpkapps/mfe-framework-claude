# `@company/mfe-angular`

The Angular 19 adapter. An Angular container uses it to declare its App or
Widget, to read the shell's services from inside a mount, and to host other
definitions; a shell of any framework uses it to recognise Angular containers
in the registry. It depends only on the neutral `@company/mfe-core` and
`@company/mfe-runtime`, never on another adapter, and names no UI library: a
component library enters a container through what the container itself
provides.

An application imports this package alone — its root, `/host`, `/registry` or
`/testing` — and never the core or the runtime directly.

## Zoneless, and nothing else

Every mount is its own Angular application, created with `createApplication`
and `provideExperimentalZonelessChangeDetection()`, on the page's shared
browser platform. There is no `zone.js` anywhere: not in this package, not in a
container's polyfills. Zone patches timers, promises and event listeners for
the whole page, which the framework forbids everywhere else, and one scheduler
per mount is what lets several Angular containers and a shell of any framework
share a page without noticing each other.

What that means for an author is ordinary zoneless Angular: state that renders
lives in signals (or is marked with `markForCheck()`), and components are
`OnPush` by habit. A plain field mutated from a `setTimeout` does not render.

## Building a container

An Angular container is built with the `@company/mfe-nx` Nx plugin, which also
scaffolds one. The build reads `src/mfe.ts` and the App's route files statically,
publishes the registry entry with `mfe.framework: 'angular'`, and generates the
container's `#mfe/config` and `#mfe/fetch` modules; the generated fetch imports
`createContainerTransport` from this package, which is why it is exported here.

## How a host mounts an Angular container

Every host places every definition the same way, through the runtime's
`mountDefinition`, whichever framework the host and the definition are written
in. `createApp` and `createWidget` return plain, branded records the build
discovers statically, each carrying the `mount` the runtime calls. The runtime
creates the scope root (`data-mfe-scope`, `data-mfe-mount`, `data-mfe-kind`) and
the body-level overlay root, and hands the definition an element inside the
scope root; the definition creates one application for that mount, renders into
a child element of its own — Angular removes the element a component was
created on when it is destroyed, and the runtime's element is the runtime's —
and tears the whole application down on `dispose()`, or when the mount's signal
aborts. It never adds a root of its own.

An application destroyed by anything but that `dispose()` — code inside it
destroying its `ApplicationRef`, or the platform going down — would leave the
host an empty element, so the definition reports it through the target's
`onFailure`: the mount moves to its error state and the host can offer a retry.

A shell lists every adapter it reads the registry through; none is registered
implicitly:

```ts
import { angularAdapter } from '@company/mfe-angular/registry'
import { createMfeRuntime } from '@company/mfe-angular/host'

const { runtime } = createMfeRuntime({ registryEntries, adapters: [angularAdapter /* , … */] })
```

`@company/mfe-angular/registry` exports the adapter alone and imports no
Angular, so a shell that is not Angular never resolves Angular to read its
registry. `detect` claims exactly the entries whose `mfe.framework` is
`'angular'`, however broken the rest of the entry is, so no other adapter ever
reads one; `parse` is the runtime's `parseFederatedEntry`, the one reading of
the entry shape every framework build publishes.

### What every Angular container needs of the page

Some things every Angular container relies on and none of them ships: a UI
library's design tokens, shared utility properties, an icon font. A host names
them once, with `createAngularAdapter`, in place of `angularAdapter`:

```ts
import { createAngularAdapter } from '@company/mfe-angular/registry'

export const angularAdapter = createAngularAdapter({
  pageAssets: async () => {
    await import('./angular.css')
    await document.fonts.load('400 24px "Material Symbols Rounded"')
  },
})
```

`pageAssets` runs once per page, beside the first Angular container's own
download, inside the adapter's `aroundLoad`, and every Angular load waits for
it. A load is part of a mount's `pending` state, so the host shows its loading
state meanwhile and no Angular definition mounts before the assets have
arrived: nothing paints unstyled. A page that loads no Angular container never
runs it. A rejection fails the load that was waiting, as `load/entry-failure`
naming that definition, and is forgotten, so a retry runs it again. The adapter
names no library: what the assets are is entirely the host's function. The
shell's are in `apps/shell/src/angular/`.

## An App

```ts
// src/mfe.ts
import { createApp } from '@company/mfe-angular'

import { routes } from './app.routes'

export const reportsApp = createApp({ id: 'reports', version: '0.1.0', routes })
```

```ts
// src/app.routes.ts
import type { Routes } from '@angular/router'
import { mfeRouteData } from '@company/mfe-angular'

import { OverviewComponent } from './overview.component'
import { SettingsComponent } from './settings.component'

export const routes: Routes = [
  { path: '', component: OverviewComponent },
  {
    path: 'settings',
    component: SettingsComponent,
    data: mfeRouteData({
      capability: { name: 'settings', label: 'Reports settings', icon: 'settings' },
    }),
  },
]
```

Route paths are relative to the boundary the host assigns. The App's router
reads and writes the host's navigation bridge through `BoundaryLocationStrategy`
and never touches `window.history`; `APP_BASE_HREF` is the boundary, and
`Location` strips it as it would a real base href. An App mounted while the page
is outside its boundary waits for the page to arrive instead of routing a path it
does not own.

`createApp` also takes `component` (a root of your own; it must render a
`<router-outlet />`, and defaults to one that renders only that),
`routerFeatures` (`withComponentInputBinding()` and the like — the mount owns
the router's location and first navigation), `providers` (environment providers
for the App's application, created once per mount) and `breadcrumbs: false`.
The author's providers are applied first, so none of them can replace what the
mount owns: change detection, the `ErrorHandler`, the mount tokens and the
router's location.

**Capability routes** are read by the build out of the route file, so a
capability route writes `data: mfeRouteData({ … })` inline, on an object with a
literal `path`, directly or inside a parent's `children`.

**Breadcrumbs** are derived from the activated routes after every navigation:
a route's own `mfeRouteData({ breadcrumb })` (`false` leaves it out), else its
`title`, else its last path segment (`:reportId` shows the parameter's value,
a generic `:id` shows nothing, `asset-reports` reads "Asset reports"). Empty-path
and wildcard routes never contribute, and the deepest route is the current one.
Only a route's own data counts: Angular copies a componentless parent's data
into its children, which would otherwise label every child with the parent.

**Shell-state transitions** need no handling: the injectables below are live
signals. An identity or group change does not reload the router — Angular has no
`invalidate` — so a resolver whose result depends on the user re-reads it itself.

## Authenticated HttpClient calls

The generated `#mfe/fetch` already uses the shell's session. Existing Angular
`HttpClient` services can use the same token without an app-owned auth library:

```ts
import { provideHttpClient, withInterceptors } from '@angular/common/http'
import { createMfeHttpAuthInterceptor } from '@company/mfe-angular'
import { apiOrigins, getAccessToken } from '#mfe/fetch'
import { config } from '#mfe/config'

const providers = [
  provideHttpClient(
    withInterceptors([
      createMfeHttpAuthInterceptor({ apiOrigins, apiBaseUrl: config.apiBaseUrl, getAccessToken }),
    ]),
  ),
]
```

Declare API URLs with `env(…, { api: true })` so `apiOrigins` names the trusted
origins. As with `#mfe/fetch`, a request gets the token when it goes to one of
them. Pass `apiBaseUrl` to hold requests to that URL's origin to its path; other
declared origins are unaffected. A relative URL is matched against the document,
where `HttpClient` sends it, and is never redirected to the API, so a service that
calls a relative path is authenticated only when the page's own origin is
declared. The interceptor leaves caller-supplied authorization alone and
refreshes once on a 401. The shell must install its session before mounting the
container.

## A Widget

```ts
// src/mfe.ts
import { createWidget } from '@company/mfe-angular'
import { z } from 'zod'

import { AlertPanelComponent } from './alert-panel.component'

export const alertPanelContract = {
  inputSchema: z.object({ label: z.string() }),
  outputSchema: z.object({ activated: z.object({ at: z.string() }) }),
}

export const alertPanel = createWidget({
  id: 'alert-panel',
  version: '0.1.0',
  ...alertPanelContract,
  component: AlertPanelComponent,
})
```

```ts
// src/alert-panel.component.ts
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core'

@Component({
  selector: 'app-alert-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button type="button" (click)="activate()">{{ label() }}</button>`,
})
export class AlertPanelComponent {
  readonly label = input.required<string>()
  readonly activated = output<{ at: string }>()

  activate(): void {
    this.activated.emit({ at: new Date().toISOString() })
  }
}
```

The component is the contract: **every input key is a component input, and
every property of the `outputSchema` is a component output of the same public
name.** The mount checks
that with `reflectComponentType` before creating anything, and a mismatch
rejects the mount with the missing member and the line to add. The component may
declare further inputs, which keep their defaults. Required-ness in the
`outputSchema` is ignored: any output may never be emitted. `input()`/`output()` and
`@Input()`/`@Output()` both work.

Inputs are validated against the schema — serializability first — before the
first render; invalid first inputs reject the mount. A later update is compared
with the last one, validated, and set on the live component for the keys that
changed; a rejected update keeps the last valid inputs, reaches the shell's
diagnostics and the host's `onInputRejected`. Every payload is validated against
its output's schema before the host sees it. An output's payload that fails is
reported rather than thrown, because Angular's output machinery would swallow or
defer the throw; `injectWidgetEmit()`, which any component inside the Widget can
use, throws at the call site.

## Injectables

All of them are called in an injection context — a constructor or a field
initialiser — and clean up with the injector that created them.

| Function                                          | Gives                                                               | Outside a mount   |
| ------------------------------------------------- | ------------------------------------------------------------------- | ----------------- |
| `injectUser()`, `injectGroups()`, `injectTheme()` | a signal over one shell-state field each                            | host scope        |
| `injectStoredState(name, schema, options)`        | `{ value: Signal<T>, set, remove }`; an unreadable value throws     | host scope        |
| `injectAction(registration \| () => …)`           | an `ActionRun`; a factory re-publishes when the signals it reads do | host scope        |
| `injectAgentContext(registration \| () => …)`     | nothing; a factory re-publishes when the signals it reads do        | host scope        |
| `injectAgentPrompt()`                             | a function that hands a prompt to the shell's chat                  | host scope        |
| `injectAgentSuggestions(suggestions)`             | prompts the chat offers while the injector lives                    | host scope        |
| `injectBreadcrumbs(items)`                        | overrides the App's own crumbs; an empty list means no override     | host crumbs, at 0 |
| `injectNavigationBlock(shouldBlock, options)`     | `{ pending: Signal<NavigationIntent \| null>, proceed(), stay() }`  | throws            |
| `injectTelemetry()`, `injectMfeSignal()`          | the mount's telemetry and its disposal signal                       | throws            |
| `injectBasePath()`, `injectMfeStorage(area)`      | the boundary (`''` for a Widget) and the imperative storage handle  | throws            |
| `injectWidgetEmit<typeof contract>()`             | the Widget's validating emit                                        | throws            |
| `injectMfeRuntime()`, `injectMfeMount()`          | the runtime; the mount (`injectOptionalMfeMount()` does not throw)  | runtime only      |

**An action and its run.** `injectAction` takes the registration `useAction`
takes. It publishes the action to the palette and, unless its `placements` say
otherwise, to the shell's agent as a tool. `description` is written for the
agent, `inputSchema` (one `z.object`, at module scope) parses every call's input
before `execute` receives it, and `outputSchema` checks the returned value.
`effect` is `'read'`, `'write'` or `'destructive'`; an undeclared one counts as
`'write'`, so the agent asks the user before each call. It returns an
`ActionRun` with the caller `'ui'`, for the component's own button, so a click
shares `canExecute`, validation and the denial notice with every other caller.
It runs this injector's registration, even when another mount of the
definition registered the same name, and never rejects. After the component is
destroyed the run resolves `unavailable`. The package
exports `ActionEffect`, `ActionInputSchema`, `ActionRun` and
`ActionExecutionResult` as types.

```ts
@Component({
  selector: 'fieldwork-overview',
  template: `<p-button label="Log inspection" (onClick)="logInspectionAction()" />`,
})
export class OverviewComponent {
  protected readonly padId = signal<string | null>(null)
  protected readonly logInspectionAction: ActionRun

  constructor() {
    this.logInspectionAction = injectAction(() => ({
      name: 'log-inspection',
      label: 'Fieldwork: log an inspection at the chosen pad',
      description: 'Logs an inspection at the well pad the user has chosen, signed by them.',
      canExecute: () => (this.padId() === null ? deny('Choose a well pad first.') : allow()),
      execute: () => this.logInspection(),
    }))
  }
}
```

**An action's shortcut.** `injectAction` passes the registration through as it
is, so `shortcut` works as in any adapter: a chord such as `'mod+s'` or a
sequence such as `'g r'`, where `mod` is ⌘ on a Mac and Ctrl elsewhere. The host
reads every key once and runs the action through the palette's path, so
`canExecute` still decides. An App's shortcut fires while the page is inside the
App's boundary; a Widget's is ignored, and so is one the host page already uses,
each with a diagnostic.

```ts
injectAction({
  name: 'export',
  label: 'Export the insights',
  shortcut: 'mod+e',
  execute: () => this.export(),
})
```

**What the agent is told.** `injectAgentContext` takes the registration
`useAgentContext` takes, or a factory that returns one: `description`, `schema`
and `value`. It publishes a small snapshot of what is selected or open, which
the shell's agent receives with each turn: ids and a short label, JSON of at
most 4096 characters, never whole records or secrets. A factory runs again when
a signal it reads changes, and an equal value publishes nothing. An invalid
value is left out and reported once as a warning. The snapshot goes when the
injector is destroyed or the mount is disposed. `injectAgentPrompt()` returns a
function that hands `{ message, context?, submit? }` to the shell's chat and
returns whether a chat took it; `false` when the shell has no chat.
`injectAgentSuggestions` offers up to three such prompts, as a list or a factory
of signals, which the chat shows as chips while the injector lives. The package
exports `AgentContextEntry`, `AgentContextRegistration`, `AgentPrompt` and
`AgentSuggestion` as types.

```ts
const selectedPad = z.object({ id: z.string(), name: z.string() }).nullable()

injectAgentContext(() => ({
  description: 'The well pad the user has chosen, or null before they choose one',
  schema: selectedPad,
  value: this.pad(),
}))
```

**The mount's elements.** `injectMfeMount()` carries the two elements the
runtime created for the mount: `scopeRoot`, the element with the mount's scope
attributes that the definition renders inside, and `overlayRoot`, the body-level
element its overlays portal into. Both are reachable from anywhere in the
mount's injector, including the environment providers a definition passes as
`providers`, so a container's theming code can mark them — toggle a dark-mode
class on both when `injectTheme()` changes, say — from a
`provideEnvironmentInitializer` with no help from its root component:

```ts
export function provideDarkModeClass(className: string): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      const { scopeRoot, overlayRoot } = injectMfeMount()
      const theme = injectTheme()
      effect(() => {
        for (const root of [scopeRoot, overlayRoot]) {
          root.classList.toggle(className, theme() === 'dark')
        }
      })
    }),
  ])
}
```

"Host scope" is the reserved `@host` scope shell chrome uses, reached through
`provideMfeRuntime(runtime)`. Each shell-state signal subscribes to its own field
only, so a theme change never notifies a consumer of the user.

**Navigation blocking.** Inside an App, a route's `canDeactivate` guards are the
first line: the mount registers one delegate with the host's navigator, and a
host navigation that leaves the App runs the guards of the whole active tree —
the component each guard is for, `nextState.url` set to where the page is going,
a `UrlTree` sending the App there instead. A navigation inside the App is left to
the App's own router, which runs the guards itself when the location reaches it.
`injectNavigationBlock` covers what no route owns, and a Widget, which has no
router: the pending intent is handed back as a signal so the mount renders its
own confirmation. Its `unloadPrompt` option (default `true`) decides whether it
asks for the browser's reload prompt while it blocks. A mount disposed mid-
negotiation always answers, so the host is never stranded.

## Hosting definitions from Angular

An Angular host — a shell, or an App placing others — places definitions by id
with two components. Both mount through the runtime's `mountDefinition` and
never ask which framework built what they place, so they host Angular
definitions and definitions any other adapter built alike. A shell provides the
runtime once; inside a mount, the mount's own runtime is used.

```ts
import { createMfeRuntime, provideMfeRuntime } from '@company/mfe-angular/host'

bootstrapApplication(ShellComponent, {
  providers: [provideExperimentalZonelessChangeDetection(), provideMfeRuntime(runtime)],
})
```

```html
<mfe-widget
  widgetId="alert-panel"
  [inputs]="{ label: 'Acknowledge' }"
  [contract]="alertPanelContract"
  [pending]="loading"
  (output)="onWidgetOutput($event)"
  (failed)="error = $event"
/>
<mfe-app-host appId="reports" basePath="/reports" />
```

Both components keep what the runtime decides out of the host's hands:

- **`status`** is a signal over the mount's state — `pending`, `mounted`,
  `error` or `disposed` — and the `pending` template shows while it is
  `pending`.
- **`(failed)`** emits each time the mount enters its error state: a failed load,
  a failed mount, or a definition that failed once mounted.
- **`retry()`** acts only after a failure. A failed load is loaded afresh; a
  failed mount reuses the loaded definition.
- **`[inputs]`** reaches the Widget only when it changed: the runtime drops an
  input set shallow-equal to the last one, and one set while the Widget was
  mounting arrives once, when it has mounted.
- **Nesting.** Inside a mount, a placed definition is one level deeper than the
  mount it sits in and is disposed with it.

`<mfe-widget>` emits each output through `(output)` as an `MfeWidgetOutput`
(`{ name, payload }`). It validates outputs against a `contract` it is given
and reports, rather than delivers, one that fails. Inside an App,
`mfeAppRoute({ appId, path: 'reports' })` delegates everything below a prefix to
another App: the boundary is the parent's boundary joined with the matched
prefix, and the nested App is one level deeper. A routed `<mfe-app-host>` tells
the runtime's navigator after every navigation of the router it sits under
(`announce()`), so an App placed below a shell router that writes the page's
history directly still follows the shell. Registry views are signals:
`injectRegistryEntries()`, `injectApps()`, `injectWidgets()`,
`injectCapabilityPages(name?)` and `injectActiveDefinition(location)` — `hidden`
is a listing rule, and a Widget is never a boundary.
`<mfe-definition-icon [icon]="iconData" label="Reports" />` draws a parsed
registry icon through an allowlist, and drops attributes that would run or fetch
anything.

`@company/mfe-angular/host` is the runtime's whole host surface —
`createMfeRuntime`, the federation loader, `mountDefinition`, the stores, the
navigator — re-exported from the bare `@company/mfe-runtime` specifier, plus
`provideMfeRuntime`. Every adapter's `/host` is that same surface plus its own
framework's provider, so the shell's composition reads the same whichever
framework it is written in.

## Testing

```ts
import { mountWidget } from '@company/mfe-angular/testing'

const widget = await mountWidget(alertPanel, { inputs: { label: 'Acknowledge' } })
widget.element.querySelector('button')?.click()
expect(widget.outputs).toEqual([{ name: 'activated', payload: { at: expect.any(String) } }])
```

`mountWidget` and `mountApp` place the definition through the runtime's
`mountDefinition` — the path every host takes — into an element in
`document.body`, over `createMfeTestEnvironment()`, a runtime with nothing behind
it but memory. They resolve once the first render has settled and return the
scope root the runtime created (`element`), the environment, the mount's
injector, `whenStable()`, `dispose()` and, for a Widget, `update(inputs)`, the
delivered `outputs` and the `rejectedInputs`; a mount that fails rejects with its
error and leaves nothing behind. Given an `environment` of your own, list the
definition in its `definitions`, as a shell's registry lists what it mounts.
For a host component, `createHostApplication(environment)` boots a zoneless
application with the environment's runtime provided and no mount around it, as
a shell boots one, and `renderInHost(appRef, component, setup)` renders a
component there and waits for it to settle.
`/testing` also re-exports the runtime's own test surface (`createMemoryRuntime`,
the in-process loader, the memory navigation bridge and storage, the recording
telemetry provider). `@company/mfe-angular/testing/mfe-config` and
`/testing/mfe-fetch` stand in for the generated `#mfe/config` and `#mfe/fetch`,
the same modules every adapter ships. A setup file calls `cleanup()` and
`resetGeneratedAliases()` after each test, so no mount, no host application
and no configuration leaks into the next.

## What is proven here, and what is not

Everything here runs under Vitest in jsdom, with components compiled just in
time. Angular's JIT pipeline has no transform for signal inputs, so this
package's own components and its test components use `@Input()`/`@Output()`;
the adapter drives both styles through `setInput` and `reflectComponentType`,
but `input()`/`output()` are exercised in a container's own AOT build and tests.
`pnpm run build` uses `ngc` to emit partially compiled Angular components and
declarations under `dist/`; the consuming Angular build links them. The neutral
packages also export built JavaScript and declarations. Inside this repository
the bundlers, the tests and the type checker resolve them to their TypeScript
source instead, through the `mfe-source` export condition, so a change reaches
them without a build. Two things read `dist/`: the build tooling Node loads, which
the root scripts build first, and `examples/fieldwork`, which is built like a
consumer. Its scripts build the packages it depends on where their `dist/` is out
of date, and its `dev` script rebuilds this package and the runtime as they
change. Packing refuses a missing or stale `dist/`; `pnpm release` builds every
package before it publishes.

```sh
pnpm --filter @company/mfe-angular test
pnpm --filter @company/mfe-angular typecheck
```
