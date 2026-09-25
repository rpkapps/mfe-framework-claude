/**
 * What every cross-framework scenario starts from: one memory runtime seeded with real definitions
 * from both adapters, so a React host and an Angular host resolve them through the same registry
 * and loader production uses; each framework's host placing an App or a Widget over that runtime;
 * and the page and registry reads a scenario asserts on, the release contract among them.
 *
 * The suites are `.ts` rather than `.tsx` because the repository's lint configuration covers only
 * `.ts` sources under `tools/`, so the React trees here are written with `createElement`.
 *
 * Waiting goes through Testing Library's `waitFor` rather than `vi.waitFor`: it suspends React's
 * act environment while it polls, so a React root an Angular host mounts or updates renders on
 * React's own scheduler, as it does in a browser, instead of warning that no `act` wrapped it.
 */

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  Input,
  provideEnvironmentInitializer,
  signal,
  type ApplicationRef,
  type EnvironmentProviders,
} from '@angular/core'
import {
  MfeAppHostComponent,
  MfeWidgetComponent,
  provideMfeRuntime,
  type MfeError,
  type MfeWidgetEvent,
} from '@company/mfe-angular'
import {
  createHostApplication,
  renderInHost,
  type RenderedHost,
} from '@company/mfe-angular/testing'
import { AppHost, MfeProvider, type AppFallbackProps } from '@company/mfe-react'
import {
  KIND_ATTRIBUTE,
  MOUNT_ATTRIBUTE,
  OVERLAY_ROOT_ATTRIBUTE,
  SCOPE_ATTRIBUTE,
  type MfeRuntime,
  type MountableWidgetDefinition,
} from '@company/mfe-react/host'
import {
  createMemoryRuntime,
  renderSuspending,
  type MemoryRuntime,
  type MemoryRuntimeOptions,
} from '@company/mfe-react/testing'
import { createElement as h, Suspense, type ReactNode } from 'react'
import { expect, onTestFinished, vi } from 'vitest'

/**
 * One runtime for the whole page, disposed when the test finishes. `onTestFinished` hooks run
 * after the setup's `afterEach`, whose cleanups unmount every React tree and destroy every Angular
 * host application, so every mount is gone before the runtime it registered with.
 */
export function createPageRuntime(options: MemoryRuntimeOptions): MemoryRuntime {
  const memory = createMemoryRuntime(options)
  onTestFinished(() => {
    memory.dispose()
  })
  return memory
}

/** A React host page: the runtime provided once, with a Suspense boundary for the loads. */
export function reactHostPage(runtime: MfeRuntime, children: ReactNode): ReactNode {
  return h(MfeProvider, { runtime, children: h(Suspense, { fallback: null }, children) })
}

/** An Angular host application over `runtime`: zoneless, with the runtime provided once. */
function createAngularHost(runtime: MfeRuntime): Promise<ApplicationRef> {
  return createHostApplication(null, [provideMfeRuntime(runtime)])
}

/** An Angular host placing one Widget by id, recording what `<mfe-widget>` reports. */
@Component({
  selector: 'interop-widget-host',
  imports: [MfeWidgetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (shown()) {
    <mfe-widget
      [widgetId]="widgetId"
      [inputs]="inputs()"
      (event)="events.push($event)"
      (failed)="failures.push($event)"
    />
  }`,
})
export class WidgetHostComponent {
  @Input() widgetId = ''
  readonly shown = signal(true)
  readonly inputs = signal<Readonly<Record<string, unknown>>>({})
  readonly events: MfeWidgetEvent[] = []
  readonly failures: MfeError[] = []
}

export interface AngularWidgetHost extends RenderedHost<WidgetHostComponent> {
  readonly appRef: ApplicationRef
}

/** `<mfe-widget>` in an Angular host application over `runtime`, first bound to `inputs`. */
export async function placeInAngularHost(
  runtime: MfeRuntime,
  widgetId: string,
  inputs: Readonly<Record<string, unknown>>,
): Promise<AngularWidgetHost> {
  const appRef = await createAngularHost(runtime)
  const view = await renderInHost(appRef, WidgetHostComponent, host => {
    host.widgetId = widgetId
    host.inputs.set(inputs)
  })
  return { appRef, ...view }
}

/** An Angular host placing one App at a boundary, recording what `<mfe-app-host>` reports. */
@Component({
  selector: 'interop-app-host-shell',
  imports: [MfeAppHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (shown()) {
    <mfe-app-host [appId]="appId" [basePath]="basePath" (failed)="failures.push($event)" />
  }`,
})
export class AppHostShellComponent {
  @Input() appId = ''
  @Input() basePath = ''
  readonly shown = signal(true)
  readonly failures: MfeError[] = []
}

/** An App a host placed, and how that host takes it away again. */
export interface PlacedApp {
  /** The host's element, which the App renders inside. */
  readonly container: HTMLElement
  /** Every failure the host was told about. */
  readonly failures: readonly MfeError[]
  /** The host stops placing the App, as a shell leaving its route does. */
  remove(): void
}

export type AppPlacement = (
  runtime: MfeRuntime,
  appId: string,
  basePath: string,
) => Promise<PlacedApp>

/** Each framework's App host; every App scenario holds for both. */
export const appHosts: readonly (readonly [string, AppPlacement])[] = [
  [
    'React’s AppHost',
    async (runtime, appId, basePath) => {
      const failures: MfeError[] = []
      // Recorded while the fallback renders, so a failure may be recorded more than once; the
      // scenarios only ever assert that there is none.
      const fallback = ({ error }: AppFallbackProps): ReactNode => {
        failures.push(error)
        return null
      }
      const view = await renderSuspending(
        reactHostPage(runtime, h(AppHost, { appId, basePath, fallback })),
      )
      return {
        container: view.container,
        failures,
        remove: () => {
          view.unmount()
        },
      }
    },
  ],
  [
    'Angular’s <mfe-app-host>',
    async (runtime, appId, basePath) => {
      const appRef = await createAngularHost(runtime)
      const { ref, element } = await renderInHost(appRef, AppHostShellComponent, shell => {
        shell.appId = appId
        shell.basePath = basePath
      })
      return {
        container: element,
        failures: ref.instance.failures,
        remove: () => {
          ref.instance.shown.set(false)
        },
      }
    },
  ],
]

/**
 * Counts the Angular applications a definition's mounts create and destroy. Each mount is its own
 * application, and an environment initializer runs once per application injector, so its
 * `DestroyRef` callback is exactly "this application was destroyed".
 */
export interface ApplicationCensus {
  /** Passed as the definition's `providers`. */
  readonly providers: EnvironmentProviders
  /** Created and not yet destroyed. */
  readonly live: number
}

export function applicationCensus(): ApplicationCensus {
  let created = 0
  let destroyed = 0

  return {
    providers: provideEnvironmentInitializer(() => {
      created += 1
      inject(DestroyRef).onDestroy(() => {
        destroyed += 1
      })
    }),
    get live() {
      return created - destroyed
    },
  }
}

export interface MountWatch {
  /** Resolves once the definition's latest mount has rendered what it was last given. */
  whenStable(): Promise<void>
}

/**
 * Reaches what `definition`'s own `mount` resolved to, which the host that placed it keeps to
 * itself, so a scenario waits on that mount's `whenStable` instead of guessing at its framework's
 * scheduler. Call it before the definition is placed.
 */
export function watchMounts(definition: MountableWidgetDefinition): MountWatch {
  const mount = vi.spyOn(definition, 'mount')
  onTestFinished(() => {
    mount.mockRestore()
  })

  return {
    whenStable: async () => {
      const latest = mount.mock.results.at(-1)
      if (latest?.type !== 'return') throw new Error(`${definition.id} was never mounted.`)
      const mounted = await latest.value
      if (mounted.whenStable === undefined) {
        throw new Error(`${definition.id}'s mount offers no whenStable to wait on.`)
      }
      await mounted.whenStable()
    },
  }
}

/** The mount a scope root belongs to, as the runtime marked it. */
export interface Scope {
  readonly id: string | null
  readonly kind: string | null
  readonly mount: string | null
}

/** Every mount `node` renders inside, innermost first. */
export function scopesAround(node: Element): readonly Scope[] {
  const found: Scope[] = []
  let root = node.closest(`[${SCOPE_ATTRIBUTE}]`)
  while (root !== null) {
    found.push({
      id: root.getAttribute(SCOPE_ATTRIBUTE),
      kind: root.getAttribute(KIND_ATTRIBUTE),
      mount: root.getAttribute(MOUNT_ATTRIBUTE),
    })
    root = root.parentElement?.closest(`[${SCOPE_ATTRIBUTE}]`) ?? null
  }
  return found
}

/** The mount `node` renders in; `null` outside every mount. */
export function scopeOf(node: Element): Scope | null {
  return scopesAround(node)[0] ?? null
}

/** What `scopeOf` reads for a mount of `id`, whatever token the runtime minted for it. */
export function expectedScope(id: string, kind: 'app' | 'widget'): Record<keyof Scope, unknown> {
  return { id, kind, mount: expect.any(String) }
}

/** The in-flow scope roots in `within`; an overlay root carries the scope attribute too. */
export function scopeRootCount(within: ParentNode = document.body): number {
  return within.querySelectorAll(`[${SCOPE_ATTRIBUTE}]:not([${OVERLAY_ROOT_ATTRIBUTE}])`).length
}

/** The body-level overlay roots every mount context creates and must remove on disposal. */
export function overlayRootCount(): number {
  return document.querySelectorAll(`[${OVERLAY_ROOT_ATTRIBUTE}]`).length
}

/**
 * The release contract every teardown asserts: nothing a mount put on the page is left, neither
 * a scope root in `within` nor an overlay root, and nothing it registered with the runtime is
 * either — no navigation blocker, breadcrumb, action or shell-state listener. Checked as one
 * value, so a failure shows every count at once.
 */
export function expectReleased(runtime: MfeRuntime, within: ParentNode = document.body): void {
  const { shellState } = runtime
  expect({
    scopeRoots: scopeRootCount(within),
    overlayRoots: overlayRootCount(),
    blockers: runtime.navigator.blockerCount,
    breadcrumbContributions: runtime.breadcrumbs.contributionCount,
    breadcrumbs: runtime.breadcrumbs.getSnapshot(),
    actions: runtime.actions.size,
    shellStateListeners: {
      user: shellState.fieldListenerCount('user'),
      groups: shellState.fieldListenerCount('groups'),
      theme: shellState.fieldListenerCount('theme'),
    },
  }).toEqual({
    scopeRoots: 0,
    overlayRoots: 0,
    blockers: 0,
    breadcrumbContributions: 0,
    breadcrumbs: [],
    actions: 0,
    shellStateListeners: { user: 0, groups: 0, theme: 0 },
  })
}
