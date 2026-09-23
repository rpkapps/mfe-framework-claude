# `@company/mfe-angular`

The Angular 19 adapter. An Angular container uses it to declare its App or
Widget, to read the shell's services from inside a mount, and to host other
definitions; a shell of any framework uses it to recognise Angular containers
in the registry. It is the sibling of `@company/mfe-react`, not a consumer of
it, and depends only on the neutral `@company/mfe-core` and `@company/mfe-host`.

## Zoneless, and nothing else

Every mount is its own Angular application, created with `createApplication`
and `provideExperimentalZonelessChangeDetection()`, on the page's shared
browser platform. There is no `zone.js` anywhere: not in this package, not in a
container's polyfills. Zone patches timers, promises and event listeners for
the whole page, which the framework forbids everywhere else, and one scheduler
per mount is what lets several Angular containers and a React shell share a
page without noticing each other.

What that means for an author is ordinary zoneless Angular: state that renders
lives in signals (or is marked with `markForCheck()`), and components are
`OnPush` by habit. A plain field mutated from a `setTimeout` does not render.

## Building a container

An Angular container is built with the `@company/mfe-nx` Nx plugin, which also
scaffolds one. The build reads `src/mfe.ts` and the App's route files statically,
publishes the registry entry with `mfe.framework: 'angular'`, and generates the
container's `#mfe/config` and `#mfe/fetch` modules; the generated fetch imports
`createContainerTransport` from this package, which is why it is exported here.

## How a shell mounts an Angular container

A React shell cannot render an Angular component tree, so the framework's
definitions mount themselves. `createApp` and `createWidget` return plain,
branded records the build discovers statically, each carrying a `mount` the
host calls with an element and a mount context. The host renders the scope root
(`data-mfe-scope`, `data-mfe-mount`, `data-mfe-kind`) and hands over an element
inside it; the definition creates one application for that mount, renders into a
child element of its own — Angular removes the element a component was created
on when it is destroyed, and the host's element is the host's — and tears the
whole application down on `dispose()`, or when the mount's signal aborts.

The shell registers the adapter beside its own:

```ts
import { angularAdapter } from '@company/mfe-angular/registry'
import { createMfeRuntime } from '@company/mfe-react'

const { runtime } = createMfeRuntime({ registryEntries, adapters: [angularAdapter] /* … */ })
```

`@company/mfe-angular/registry` exports the adapter alone and imports no
Angular, so a shell that is not Angular never resolves Angular to read its
registry. `detect` claims exactly the entries whose `mfe.framework` is
`'angular'`, however broken the rest of the entry is; `parse` is as strict as the
React adapter's, with the same messages. The React adapter reads every other
framework entry, so the two never both claim one.

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
    data: mfeRouteData({ capability: 'settings', label: 'Reports settings', icon: 'settings' }),
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

## A Widget

```ts
// src/mfe.ts
import { createWidget } from '@company/mfe-angular'
import { z } from 'zod'

import { AlertPanelComponent } from './alert-panel.component'

export const alertPanelContract = {
  inputs: z.object({ label: z.string() }),
  events: { activated: z.object({ at: z.string() }) },
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
every event is a component output of the same public name.** The mount checks
that with `reflectComponentType` before creating anything, and a mismatch
rejects the mount with the missing member and the line to add. The component may
declare further inputs, which keep their defaults. `input()`/`output()` and
`@Input()`/`@Output()` both work.

Inputs are validated against the schema — serializability first — before the
first render; invalid first inputs reject the mount. A later update is compared
with the last one, validated, and set on the live component for the keys that
changed; a rejected update keeps the last valid inputs, reaches the shell's
diagnostics and the host's `onInputRejected`. Every payload is validated against
its event schema before the host sees it. An output's payload that fails is
reported rather than thrown, because Angular's output machinery would swallow or
defer the throw; `injectWidgetEmit()`, which any component inside the Widget can
use, throws at the call site.

## Injectables

All of them are called in an injection context — a constructor or a field
initialiser — and clean up with the injector that created them.

| Function                                          | Gives                                                                  | Outside a mount   |
| ------------------------------------------------- | ---------------------------------------------------------------------- | ----------------- |
| `injectUser()`, `injectGroups()`, `injectTheme()` | a signal over one shell-state field each                               | host scope        |
| `injectStoredState(name, schema, options)`        | `{ value: Signal<T>, set, remove }`; an unreadable value throws        | host scope        |
| `injectCommand(registration \| () => …)`          | a palette command; a factory re-publishes when the signals it reads do | host scope        |
| `injectBreadcrumbs(items)`                        | overrides the App's own crumbs; an empty list means no override        | host crumbs, at 0 |
| `injectNavigationBlock(shouldBlock, options)`     | `{ pending: Signal<NavigationIntent \| null>, proceed(), stay() }`     | throws            |
| `injectTelemetry()`, `injectMfeSignal()`          | the mount's telemetry and its disposal signal                          | throws            |
| `injectBasePath()`, `injectMfeStorage(area)`      | the boundary (`''` for a Widget) and the imperative storage handle     | throws            |
| `injectWidgetEmit<typeof contract>()`             | the Widget's validating emit                                           | throws            |
| `injectMfeRuntime()`, `injectMfeMount()`          | the runtime; the mount (`injectOptionalMfeMount()` does not throw)     | runtime only      |

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

An Angular host — a shell, or an App placing others — provides the runtime once
and places definitions by id. Both components mount through the neutral
`definition.mount`, so they host Angular definitions and definitions any other
adapter built.

```ts
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
  (event)="onWidgetEvent($event)"
  (failed)="error = $event"
/>
<mfe-app-host appId="reports" basePath="/reports" />
```

`<mfe-widget>` validates events against a `contract` it is given and reports,
rather than delivers, one that fails; `retry()` forgets a failed load and
mounts afresh. Inside an App, `mfeAppRoute({ appId, path: 'reports' })` delegates
everything below a prefix to another App: the boundary is the parent's boundary
joined with the matched prefix, and the nested App is one level deeper. Registry
views are signals: `injectRegistryEntries()`, `injectApps()`, `injectWidgets()`,
`injectCapabilityPages(name?)` and `injectActiveDefinition(location)`, with the
React host's rules — `hidden` is a listing rule, and a Widget is never a
boundary. `<mfe-definition-icon [icon]="iconData" label="Reports" />` draws a parsed registry icon
through the same allowlist as the React one, and drops attributes that would run
or fetch anything. `createMfeRuntime` registers the Angular adapter;
`createMf2ContainerLoader({ runtime })` is the federation loader.

## Testing

```ts
import { mountWidget } from '@company/mfe-angular/testing'

const widget = await mountWidget(alertPanel, { inputs: { label: 'Acknowledge' } })
widget.element.querySelector('button')?.click()
expect(widget.events).toEqual([{ name: 'activated', payload: { at: expect.any(String) } }])
```

`mountWidget` and `mountApp` call the definition's own `mount` — the path a shell
takes — inside a scope root in `document.body`, over `createMfeTestEnvironment()`,
a runtime with nothing behind it but memory. They resolve once the first render
has settled and return the element, the environment, the mount's injector,
`whenStable()`, `dispose()` and, for a Widget, `update(inputs)`, the delivered
`events` and the `rejectedInputs`. `@company/mfe-angular/testing/mfe-config` and
`/testing/mfe-fetch` stand in for the generated `#mfe/config` and `#mfe/fetch`
exactly as the React adapter's do. A setup file calls `cleanup()` and
`resetGeneratedAliases()` after each test, so no mount and no configuration
leaks into the next.

## What is proven here, and what is not

Everything here runs under Vitest in jsdom, with components compiled just in
time. Angular's JIT pipeline has no transform for signal inputs, so this
package's own components and its test components use `@Input()`/`@Output()`;
the adapter drives both styles through `setInput` and `reflectComponentType`,
but `input()`/`output()` are exercised only in a container's own AOT build and
its tests. This package ships TypeScript source with decorated components, which
a container compiles ahead of time with its application; a published build would
need Angular's partial compilation. No real container has been built against it
in this repository, which is not an Nx workspace.

```sh
pnpm --filter @company/mfe-angular test
pnpm --filter @company/mfe-angular typecheck
```
