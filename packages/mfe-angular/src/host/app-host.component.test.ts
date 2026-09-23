import { Component, signal, ViewChild } from '@angular/core'
import { Router } from '@angular/router'
import { DEFINITION_BRAND, type MfeError } from '@company/mfe-core'
import type { AppMountTarget, MountableAppDefinition } from '@company/mfe-host'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createHostApplication, renderInHost } from '../__tests__/harness.ts'
import { createApp, createWidget } from '../definition.ts'
import { injectMfeMount } from '../inject/runtime.ts'
import { injectBasePath } from '../inject/services.ts'
import { mfeAppRoute } from '../routing/app-route.ts'
import { createMfeTestEnvironment, mountApp } from '../testing/index.ts'
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
  inputs: z.object({}),
  events: {},
  component: NoopComponent,
})

function foreignApp(id: string) {
  const calls = { targets: [] as AppMountTarget[], disposals: 0 }
  const definition: MountableAppDefinition = {
    [DEFINITION_BRAND]: true,
    kind: 'app',
    framework: 'react',
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
      'a Widget definition, which owns no URL boundary',
    )

    ref.instance.host?.retry()
    await vi.waitFor(() => {
      expect(ref.instance.failures).toHaveLength(2)
    })
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
