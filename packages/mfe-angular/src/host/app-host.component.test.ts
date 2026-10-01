import { APP_BASE_HREF, LocationStrategy } from '@angular/common'
import { ApplicationRef, Component, getDebugNode, inject, signal, ViewChild } from '@angular/core'
import { provideRouter, Router, RouterOutlet } from '@angular/router'
import { createMfeError, DEFINITION_BRAND, type MfeError } from '@company/mfe-core'
import type { AppMountTarget, MountableAppDefinition } from '@company/mfe-runtime'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget } from '../definition.ts'
import { injectMfeMount } from '../inject/runtime.ts'
import { injectBasePath } from '../inject/services.ts'
import { mfeAppRoute } from '../routing/app-route.ts'
import { BoundaryLocationStrategy } from '../routing/boundary-location-strategy.ts'
import {
  createHostApplication,
  createMfeTestEnvironment,
  mountApp,
  renderInHost,
} from '../testing/index.ts'
import { MfeAppHostComponent } from './app-host.component.ts'

@Component({ selector: 'test-where', template: '<p class="where">{{ where }}</p>' })
class WhereComponent {
  readonly where = `${injectMfeMount().definitionId} at ${injectBasePath()} depth ${String(injectMfeMount().depth)}`
}

@Component({ selector: 'test-home', template: '<p class="home">home</p>' })
class HomeComponent {}

const childApp = createApp({
  id: 'child',
  routes: [
    { path: '', component: HomeComponent },
    { path: 'detail', component: WhereComponent },
  ],
})

const parentApp = createApp({
  id: 'parent',
  routes: [
    { path: '', component: HomeComponent },
    mfeAppRoute({ appId: 'child', path: 'reports' }),
  ],
})

@Component({ selector: 'test-noop', template: '' })
class NoopComponent {}

const notAnApp = createWidget({
  id: 'not-an-app',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  component: NoopComponent,
})

function foreignApp(id: string) {
  const calls = { targets: [] as AppMountTarget[], disposals: 0 }
  const definition: MountableAppDefinition = {
    [DEFINITION_BRAND]: true,
    kind: 'app',
    framework: 'plain-dom',
    requiresRuntime: '>=1.1.0 <2.0.0',
    id,
    contributesBreadcrumbs: true,
    mount: target => {
      calls.targets.push(target)
      target.element.textContent = `${id} mounted`
      return Promise.resolve({
        dispose: () => {
          calls.disposals += 1
          target.element.textContent = ''
          return Promise.resolve()
        },
      })
    },
  }
  return { definition, calls }
}

@Component({
  selector: 'test-host',
  imports: [MfeAppHostComponent],
  template: `@if (shown()) {
    <mfe-app-host #host [appId]="appId()" basePath="/placed" (failed)="failures.push($event)" />
  }`,
})
class HostComponent {
  readonly shown = signal(true)
  readonly appId = signal('child')
  readonly failures: MfeError[] = []
  @ViewChild('host') host: MfeAppHostComponent | undefined
}

describe('<mfe-app-host>', () => {
  it('reports a placement error without adding UI and recovers after the host supplies an id', async () => {
    @Component({
      selector: 'test-unplaced',
      imports: [MfeAppHostComponent],
      template: '<mfe-app-host #host [appId]="appId()" basePath="/placed" />',
    })
    class UnplacedHost {
      readonly appId = signal<string | undefined>(undefined)
      @ViewChild('host') host: MfeAppHostComponent | undefined
    }
    const { definition, calls } = foreignApp('elsewhere')
    const environment = createMfeTestEnvironment({ definitions: [definition] })
    const appRef = await createHostApplication(environment)
    const { ref, element } = await renderInHost(appRef, UnplacedHost)
    await vi.waitFor(() => {
      expect(ref.instance.host?.status()).toBe('error')
    })
    expect(element.querySelector('mfe-app-host')?.children).toHaveLength(0)
    expect(element.textContent?.trim()).toBe('')
    expect(ref.instance.host?.error()?.operation).toBe('place an App')
    expect(environment.diagnostics).toHaveLength(1)

    ref.instance.appId.set('elsewhere')
    await appRef.whenStable()
    await vi.waitFor(() => {
      expect(element.textContent).toContain('elsewhere mounted')
    })
    expect(element.querySelector('[role="alert"]')).toBeNull()
    expect(calls.targets).toHaveLength(1)

    ref.instance.appId.set(undefined)
    await appRef.whenStable()
    await vi.waitFor(() => {
      expect(ref.instance.host?.status()).toBe('error')
      expect(calls.disposals).toBe(1)
    })
    expect(element.textContent?.trim()).toBe('')

    ref.instance.appId.set('elsewhere')
    await appRef.whenStable()
    await vi.waitFor(() => {
      expect(ref.instance.host?.status()).toBe('mounted')
      expect(element.textContent).toContain('elsewhere mounted')
    })
    expect(calls.targets).toHaveLength(2)
    environment.dispose()
  })

  it('lets a routed consumer own loading/error templates, scoped styles and recovery controls', async () => {
    @Component({
      selector: 'consumer-placement',
      imports: [MfeAppHostComponent],
      template: `
        <mfe-app-host
          #host
          [pending]="loading"
          [fallback]="failure"
          (failed)="failures.push($event)"
        />
        <ng-template #loading
          ><span class="consumer-loading">Waiting for the App</span></ng-template
        >
        <ng-template
          #failure
          let-error
          let-retry="retry"
          let-reload="reload"
          let-recovery="recovery"
          let-attempt="attempt"
        >
          <p class="consumer-error" [attr.data-recovery]="recovery" [attr.data-attempt]="attempt">
            {{ error.code }}
          </p>
          @if (recovery === 'retry' || recovery === 'correct-inputs') {
            <button class="consumer-retry" (click)="retry()">Try this App again</button>
          } @else {
            <button class="consumer-reload" (click)="reload()">Reload the page</button>
          }
        </ng-template>
      `,
      styles: `
        .consumer-loading {
          color: rgb(45, 67, 89);
        }
        .consumer-error {
          color: rgb(56, 78, 90);
        }
      `,
    })
    class ConsumerPlacement {
      readonly failures: MfeError[] = []
      @ViewChild('host') host: MfeAppHostComponent | undefined
    }
    @Component({ selector: 'test-shell', imports: [RouterOutlet], template: '<router-outlet />' })
    class ShellComponent {}
    const { definition, calls } = foreignApp('elsewhere')
    const environment = createMfeTestEnvironment({
      definitions: [definition],
      initialEntries: ['/reports'],
    })
    let failLoad!: () => void
    const firstLoad = new Promise<never>((_resolve, reject) => {
      failLoad = () => {
        reject(
          createMfeError({
            code: 'load/manifest-failure',
            id: 'elsewhere',
            operation: 'fetch manifest',
            observed: 'LAN node restarting',
            repair: 'Retry after the node is available.',
          }),
        )
      }
    })
    const load = vi
      .spyOn(environment.runtime.loader, 'load')
      .mockImplementationOnce(() => firstLoad)
    const appRef = await createHostApplication(environment, [
      provideRouter([
        { ...mfeAppRoute({ appId: 'elsewhere', path: 'reports' }), component: ConsumerPlacement },
      ]),
      { provide: APP_BASE_HREF, useValue: '/' },
      {
        provide: LocationStrategy,
        useValue: new BoundaryLocationStrategy(environment.navigation, '/'),
      },
    ])
    const { element } = await renderInHost(appRef, ShellComponent)
    await appRef.injector.get(Router).navigateByUrl('/reports')
    await appRef.whenStable()
    const loading = element.querySelector('.consumer-loading')!
    expect(loading.textContent).toBe('Waiting for the App')
    expect(getComputedStyle(loading).color).toBe('rgb(45, 67, 89)')
    expect(load).toHaveBeenCalledOnce()
    const consumer = getDebugNode(element.querySelector('consumer-placement'))?.injector.get(
      ConsumerPlacement,
    )
    expect(consumer?.host?.status()).toBe('pending')

    failLoad()
    await vi.waitFor(() => {
      expect(element.querySelector('.consumer-error')).not.toBeNull()
    })
    const failure = element.querySelector('.consumer-error')!
    expect(failure.textContent?.trim()).toBe('load/manifest-failure')
    expect(failure.getAttribute('data-recovery')).toBe('retry')
    expect(failure.getAttribute('data-attempt')).toBe('1')
    expect(getComputedStyle(failure).color).toBe('rgb(56, 78, 90)')
    expect(consumer?.failures).toHaveLength(1)
    expect(element.querySelector('mfe-definition-status')).toBeNull()
    element.querySelector<HTMLButtonElement>('.consumer-retry')!.click()
    await vi.waitFor(() => {
      expect(calls.targets).toHaveLength(1)
    })
    await appRef.whenStable()
    expect(calls.targets[0]?.context.basePath).toBe('/reports')
    expect(element.textContent).toContain('elsewhere mounted')
    expect(element.querySelector('.consumer-error')).toBeNull()
    expect(load).toHaveBeenCalledTimes(2)

    calls.targets[0]?.onFailure(
      createMfeError({
        code: 'load/reload-required',
        id: 'elsewhere',
        operation: 'load another chunk',
        observed: 'the loaded release is unavailable',
        repair: 'Reload the page.',
      }),
    )
    await vi.waitFor(() => {
      expect(element.querySelector('.consumer-reload')).not.toBeNull()
    })
    expect(element.querySelector('.consumer-error')?.getAttribute('data-recovery')).toBe('reload')
    const reload = vi.spyOn(consumer!.host!, 'reload').mockImplementation(() => undefined)
    element.querySelector<HTMLButtonElement>('.consumer-reload')!.click()
    expect(reload).toHaveBeenCalledOnce()
    environment.dispose()
  })

  it('mounts an App at the boundary it is given, one level below the host', async () => {
    const environment = createMfeTestEnvironment({
      definitions: [childApp],
      initialEntries: ['/placed/detail'],
    })
    const appRef = await createHostApplication(environment)

    const { element } = await renderInHost(appRef, HostComponent)

    await vi.waitFor(() => {
      expect(element.querySelector('.where')?.textContent).toBe('child at /placed depth 1')
    })
    expect(element.querySelector('[data-mfe-kind="app"]')?.getAttribute('data-mfe-scope')).toBe(
      'child',
    )
    environment.dispose()
  })

  it('hosts an App another adapter built, and disposes it with the host', async () => {
    const { definition, calls } = foreignApp('elsewhere')
    const environment = createMfeTestEnvironment({ definitions: [definition] })
    const appRef = await createHostApplication(environment)
    const { element, ref } = await renderInHost(appRef, HostComponent, host => {
      host.appId.set('elsewhere')
    })
    await vi.waitFor(() => {
      expect(calls.targets).toHaveLength(1)
    })
    expect(calls.targets[0]?.context).toMatchObject({ kind: 'app', basePath: '/placed', depth: 1 })
    expect(element.textContent).toContain('elsewhere mounted')

    ref.instance.shown.set(false)
    await appRef.whenStable()

    await vi.waitFor(() => {
      expect(calls.disposals).toBe(1)
    })
    expect(calls.targets[0]?.context.signal.aborted).toBe(true)
    environment.dispose()
  })

  it('refuses a Widget, which owns no URL boundary, and mounts afresh on retry', async () => {
    const environment = createMfeTestEnvironment({ definitions: [notAnApp] })
    const appRef = await createHostApplication(environment)
    const { ref } = await renderInHost(appRef, HostComponent, host => {
      host.appId.set('not-an-app')
    })

    await vi.waitFor(() => {
      expect(ref.instance.failures).toHaveLength(1)
    })
    expect(ref.instance.failures[0]?.message).toContain(
      'an entry for a Widget, which owns no URL boundary',
    )

    ref.instance.host?.retry()
    await vi.waitFor(() => {
      expect(ref.instance.failures).toHaveLength(2)
    })
    environment.dispose()
  })

  it('exposes where the mount is as a status signal', async () => {
    const { definition } = foreignApp('elsewhere')
    const environment = createMfeTestEnvironment({ definitions: [definition] })
    const appRef = await createHostApplication(environment)
    const { ref } = await renderInHost(appRef, HostComponent, host => {
      host.appId.set('elsewhere')
    })

    await vi.waitFor(() => {
      expect(ref.instance.host?.status()).toBe('mounted')
    })
    environment.dispose()
  })

  it('reports an Angular App whose application was destroyed from inside, and remounts on retry', async () => {
    const captured: { application?: ApplicationRef } = {}

    @Component({ selector: 'test-self-destructing', template: '<p class="alive">alive</p>' })
    class SelfDestructingComponent {
      constructor() {
        captured.application = inject(ApplicationRef)
      }
    }
    const fragile = createApp({
      id: 'fragile',
      routes: [{ path: '', component: SelfDestructingComponent }],
    })
    const environment = createMfeTestEnvironment({
      definitions: [fragile],
      initialEntries: ['/placed'],
    })
    const appRef = await createHostApplication(environment)
    const { ref, element } = await renderInHost(appRef, HostComponent, host => {
      host.appId.set('fragile')
    })
    await vi.waitFor(() => {
      expect(element.querySelector('.alive')).not.toBeNull()
    })

    // What code inside the App would do; only the host may end a mount.
    captured.application?.destroy()

    await vi.waitFor(() => {
      expect(ref.instance.failures).toHaveLength(1)
    })
    expect(ref.instance.failures[0]).toMatchObject({ code: 'mount/failure', id: 'fragile' })
    expect(ref.instance.failures[0]?.message).toContain('the application was destroyed')
    expect(ref.instance.host?.status()).toBe('error')
    expect(element.querySelector('[data-mfe-scope]')).toBeNull()

    ref.instance.host?.retry()

    await vi.waitFor(() => {
      expect(element.querySelector('.alive')).not.toBeNull()
    })
    expect(ref.instance.host?.status()).toBe('mounted')
    environment.dispose()
  })

  it('tells the App it routes to where the host’s own router took the page', async () => {
    @Component({ selector: 'test-shell', imports: [RouterOutlet], template: '<router-outlet />' })
    class ShellComponent {}

    const environment = createMfeTestEnvironment({
      definitions: [childApp],
      initialEntries: ['/reports'],
    })
    // The shell's router writes the page's history directly, as a browser shell's router does,
    // and the bridge reports only the moves it did not make itself.
    const appRef = await createHostApplication(environment, [
      provideRouter([mfeAppRoute({ appId: 'child', path: 'reports' })]),
      { provide: APP_BASE_HREF, useValue: '/' },
      {
        provide: LocationStrategy,
        useValue: new BoundaryLocationStrategy(environment.navigation, '/'),
      },
    ])
    const { element } = await renderInHost(appRef, ShellComponent)
    const router = appRef.injector.get(Router)
    await router.navigateByUrl('/reports')
    await vi.waitFor(() => {
      expect(element.querySelector('.home')).not.toBeNull()
    })
    const announce = vi.spyOn(environment.runtime.navigator, 'announce')

    await router.navigateByUrl('/reports/detail')

    await vi.waitFor(() => {
      expect(element.querySelector('.where')?.textContent).toBe('child at /reports depth 1')
    })
    expect(environment.navigation.entries.at(-1)).toBe('/reports/detail')
    expect(announce).toHaveBeenCalledOnce()
    environment.dispose()
  })

  it('places a nested App below the prefix its parent routed to it', async () => {
    const environment = createMfeTestEnvironment({
      definitions: [parentApp, childApp],
      initialEntries: ['/parent/reports/detail'],
    })

    const parent = await mountApp(parentApp, { environment, basePath: '/parent' })

    await vi.waitFor(() => {
      expect(parent.element.querySelector('.where')?.textContent).toBe(
        'child at /parent/reports depth 2',
      )
    })
    const scopes = [...parent.element.querySelectorAll('[data-mfe-scope]')].map(scope =>
      scope.getAttribute('data-mfe-scope'),
    )
    expect(scopes).toEqual(['child'])
  })

  it('disposes the nested App when the parent routes away from it', async () => {
    const environment = createMfeTestEnvironment({
      definitions: [parentApp, childApp],
      initialEntries: ['/parent/reports/detail'],
    })
    const parent = await mountApp(parentApp, { environment, basePath: '/parent' })
    await vi.waitFor(() => {
      expect(parent.element.querySelector('.where')).not.toBeNull()
    })

    await parent.injector.get(Router).navigateByUrl('/')
    await parent.whenStable()

    await vi.waitFor(() => {
      expect(parent.element.querySelector('[data-mfe-scope="child"]')).toBeNull()
    })
    expect(parent.element.querySelector('.home')).not.toBeNull()
    expect(environment.runtime.navigator.blockerCount).toBe(1)
  })
})
