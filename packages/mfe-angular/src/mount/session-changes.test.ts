import {
  HttpClient,
  HttpRequest,
  HttpResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http'
import {
  Component,
  DestroyRef,
  inject,
  InjectionToken,
  provideAppInitializer,
  runInInjectionContext,
  signal,
} from '@angular/core'
import { ActivatedRoute, Router, type Routes } from '@angular/router'
import { createMountContext, mountDefinition } from '@company/mfe-runtime'
import { Observable } from 'rxjs'
import { storedKey } from '@company/mfe-core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget } from '../definition.ts'
import { createMfeHttpAuthInterceptor } from '../http/auth-interceptor.ts'
import { injectSession } from '../inject/session.ts'
import { injectMfeRuntime } from '../inject/runtime.ts'
import { injectAction } from '../inject/action.ts'
import { injectNavigationBlock } from '../inject/navigation-block.ts'
import { injectStoredState } from '../inject/stored-state.ts'
import { createMfeTestEnvironment, mountApp, mountWidget } from '../testing/index.ts'

const densityKey = storedKey('density', z.enum(['compact', 'comfortable']).default('compact'))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

@Component({ selector: 'test-session-route', template: '<h1>{{ data() }}</h1>' })
class SessionRoute {
  readonly data = signal('')
  constructor() {
    inject(ActivatedRoute).data.subscribe(value => {
      this.data.set(String(value['private']))
    })
  }
}

describe('Angular security session transitions', () => {
  it('remounts routes at the current URL without adding history or changing authored route policies', async () => {
    const resolve = vi.fn(() => {
      const state = injectMfeRuntime().shellState.getSnapshot()
      return `${state.user?.id ?? 'signed-out'}:${state.groups.join(',')}`
    })
    const ordinaryPolicy = vi.fn(() => false)
    const routes: Routes = [
      {
        path: ':reportId',
        component: SessionRoute,
        resolve: { private: resolve },
        runGuardsAndResolvers: ordinaryPolicy,
      },
    ]
    const definition = createApp({ id: 'session-routes', routes })
    const app = await mountApp(definition, {
      basePath: '/session-routes',
      initialEntries: ['/session-routes/42?tab=summary#totals'],
      shellState: { user: { id: 'ada', name: 'Ada' }, groups: ['admin'] },
    })
    expect(app.element.querySelector('h1')?.textContent).toBe('ada:admin')
    const history = [...app.environment.navigation.entries]
    app.environment.setShellState({ groups: ['reader'] })
    await vi.waitFor(() => {
      expect(app.element.querySelector('h1')?.textContent).toBe('ada:reader')
    })
    expect(app.element.querySelector('[hidden]')).toBeNull()
    expect(app.environment.navigation.entries).toEqual(history)
    expect(app.environment.runtime.navigator.read()).toMatchObject({
      pathname: '/session-routes/42',
      search: '?tab=summary',
      hash: '#totals',
    })
    expect(routes[0]?.runGuardsAndResolvers).toBe(ordinaryPolicy)
    app.environment.setShellState({ user: null, groups: [] })
    await vi.waitFor(() => {
      expect(app.element.querySelector('h1')?.textContent).toBe('signed-out:')
    })
    app.environment.setShellState({ theme: 'dark' })
    await app.whenStable()
    expect(resolve).toHaveBeenCalledTimes(3)
  })

  it('removes old route data immediately and prevents superseded resolver results from surfacing', async () => {
    const oldRefresh = deferred<string>()
    const newRefresh = deferred<string>()
    const started = vi.fn()
    const definition = createApp({
      id: 'pending-session',
      routes: [
        {
          path: '',
          component: SessionRoute,
          resolve: {
            private: () => {
              const user = injectMfeRuntime().shellState.getUser()
              started(user?.id ?? 'signed-out')
              return user?.id === 'ada'
                ? 'Ada data'
                : user?.id === 'grace'
                  ? oldRefresh.promise
                  : newRefresh.promise
            },
          },
        },
      ],
    })
    const app = await mountApp(definition, {
      basePath: '/pending-session',
      shellState: { user: { id: 'ada', name: 'Ada' } },
    })
    const oldView = app.element.querySelector('h1')!
    app.environment.setShellState({ user: { id: 'grace', name: 'Grace' } })
    expect(oldView.isConnected).toBe(false)
    expect(app.element.querySelector('h1')).toBeNull()
    await vi.waitFor(() => {
      expect(started).toHaveBeenCalledWith('grace')
    })
    app.environment.setShellState({ user: null })
    await vi.waitFor(() => {
      expect(started).toHaveBeenCalledWith('signed-out')
    })
    oldRefresh.resolve('Grace obsolete data')
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0)
    })
    expect(app.element.querySelector('h1')).toBeNull()
    expect(app.environment.diagnostics).toHaveLength(0)
    newRefresh.resolve('Signed-out data')
    await vi.waitFor(() => {
      expect(app.element.querySelector('h1')?.textContent).toBe('Signed-out data')
    })
    expect(app.element.querySelector('[hidden]')).toBeNull()
    expect(getComputedStyle(app.element.firstElementChild!).display).toBe('contents')
  })

  it('creates a fresh router for nested lazy routes after an account change', async () => {
    const resolve = vi.fn(() => injectMfeRuntime().shellState.getUser()?.accountId ?? 'default')
    const lazyRoutes: Routes = [
      { path: '', component: SessionRoute, resolve: { private: resolve } },
    ]
    const definition = createApp({
      id: 'lazy-session',
      routes: [{ path: '', loadChildren: async () => lazyRoutes }],
    })
    const app = await mountApp(definition, {
      basePath: '/lazy-session',
      shellState: { user: { id: 'ada', name: 'Ada' } },
    })
    expect(app.element.querySelector('h1')?.textContent).toBe('default')
    app.environment.setShellState({ user: { id: 'ada', name: 'Ada', accountId: 'other' } })
    await vi.waitFor(() => {
      expect(app.element.querySelector('h1')?.textContent).toBe('other')
    })
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(lazyRoutes[0]?.runGuardsAndResolvers).toBeUndefined()
  })

  it('fails locally if a new session cannot pass a route guard and supports retry', async () => {
    const definition = createApp({
      id: 'guarded-session',
      routes: [
        {
          path: '',
          component: SessionRoute,
          resolve: { private: () => 'Privileged data' },
          canActivate: [() => injectMfeRuntime().shellState.getUser() !== null],
        },
      ],
    })
    const environment = createMfeTestEnvironment({
      definitions: [definition],
      initialEntries: ['/guarded-session'],
      shellState: { user: { id: 'ada', name: 'Ada' } },
    })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const mounted = mountDefinition({
      runtime: environment.runtime,
      definitionId: definition.id,
      kind: 'app',
      basePath: '/guarded-session',
      element,
    })
    await vi.waitFor(() => {
      expect(mounted.state.status).toBe('mounted')
    })
    environment.setShellState({ user: null })
    await vi.waitFor(() => {
      expect(mounted.state.status).toBe('error')
    })
    if (mounted.state.status === 'error')
      expect(mounted.state.error.operation).toBe('render its first route, /')
    expect(element.textContent).not.toContain('Privileged data')
    environment.setShellState({ user: { id: 'ada', name: 'Ada' } })
    mounted.retry()
    await vi.waitFor(() => {
      expect(mounted.state.status).toBe('mounted')
      expect(element.querySelector('h1')?.textContent).toBe('Privileged data')
    })
    await mounted.dispose()
    element.remove()
    environment.dispose()
  })

  it('allows a new session guard to redirect to an allowed route', async () => {
    @Component({ selector: 'test-signed-out-route', template: '<h1>Signed out</h1>' })
    class SignedOutRoute {}
    const definition = createApp({
      id: 'redirect-session',
      routes: [
        {
          path: '',
          component: SessionRoute,
          resolve: { private: () => 'Private data' },
          canActivate: [
            () =>
              injectMfeRuntime().shellState.getUser() !== null ||
              inject(Router).parseUrl('/signed-out'),
          ],
        },
        { path: 'signed-out', component: SignedOutRoute },
      ],
    })
    const app = await mountApp(definition, {
      basePath: '/redirect-session',
      shellState: { user: { id: 'ada', name: 'Ada' } },
    })
    app.environment.setShellState({ user: null })
    await app.whenStable()
    expect(app.element.querySelector('h1')?.textContent).toBe('Signed out')
    expect(app.environment.runtime.navigator.read().pathname).toBe('/redirect-session/signed-out')
    expect(app.environment.diagnostics).toHaveLength(0)
  })

  it('recreates providers and transient state while retaining preferences and mount registrations', async () => {
    const instances: StatefulRoute[] = []
    const destroyed = vi.fn()
    const providerCreated = vi.fn(() => ({}))
    const SESSION_SERVICE = new InjectionToken<object>('SESSION_SERVICE')
    @Component({
      selector: 'test-stateful-session',
      template: '<h1>{{ draft() }}:{{ density.value() }}</h1>',
    })
    class StatefulRoute {
      readonly service = inject(SESSION_SERVICE)
      readonly draft = signal('empty')
      readonly density = injectStoredState(densityKey)
      constructor() {
        instances.push(this)
        inject(DestroyRef).onDestroy(destroyed)
        injectAction({ name: 'refresh', label: 'Refresh', execute: () => undefined })
        injectNavigationBlock(false)
      }
    }
    const definition = createApp({
      id: 'stateful-session',
      routes: [{ path: '', component: StatefulRoute }],
      providers: [{ provide: SESSION_SERVICE, useFactory: providerCreated }],
    })
    const app = await mountApp(definition, {
      basePath: '/stateful-session',
      shellState: { user: { id: 'ada', name: 'Ada' }, groups: ['reader', 'writer'] },
    })
    const token = app.element.getAttribute('data-mfe-mount')
    instances[0]!.draft.set('unsaved')
    await instances[0]!.density.set('comfortable')
    app.environment.setShellState({
      theme: 'dark',
      user: { id: 'ada', name: 'Ada renamed' },
      groups: ['writer', 'reader'],
    })
    app.environment.runtime.shellState.apply({}, { tokenRefresh: true })
    await app.whenStable()
    expect(instances).toHaveLength(1)
    expect(app.element.querySelector('h1')?.textContent).toBe('unsaved:comfortable')

    app.environment.setShellState({ groups: ['reader'] })
    expect(destroyed).toHaveBeenCalledOnce()
    await app.whenStable()
    expect(instances).toHaveLength(2)
    expect(instances[1]!.service).not.toBe(instances[0]!.service)
    expect(providerCreated).toHaveBeenCalledTimes(2)
    expect(app.element.querySelector('h1')?.textContent).toBe('empty:comfortable')
    expect(app.element.getAttribute('data-mfe-mount')).toBe(token)
    expect(app.environment.runtime.actions.size).toBe(1)
    expect(app.environment.runtime.navigator.blockerCount).toBe(1)
    await app.dispose()
    expect(destroyed).toHaveBeenCalledTimes(2)
    expect(app.environment.runtime.actions.size).toBe(0)
    expect(app.environment.runtime.navigator.blockerCount).toBe(0)
  })

  it('abandons a pending replacement initializer and destroys its late application', async () => {
    const graceReady = deferred<void>()
    const started = vi.fn()
    const destroyed = vi.fn()
    const definition = createApp({
      id: 'initializing-session',
      providers: [
        provideAppInitializer(() => {
          const user = injectMfeRuntime().shellState.getUser()?.id ?? 'signed-out'
          started(user)
          inject(DestroyRef).onDestroy(() => {
            destroyed(user)
          })
          return user === 'grace' ? graceReady.promise : undefined
        }),
      ],
      routes: [
        {
          path: '',
          component: SessionRoute,
          resolve: {
            private: () => String(injectMfeRuntime().shellState.getUser()?.id ?? 'signed-out'),
          },
        },
      ],
    })
    const app = await mountApp(definition, {
      basePath: '/initializing-session',
      shellState: { user: { id: 'ada', name: 'Ada' } },
    })
    app.environment.setShellState({ user: { id: 'grace', name: 'Grace' } })
    await vi.waitFor(() => {
      expect(started).toHaveBeenCalledWith('grace')
    })
    app.environment.setShellState({ user: null })
    await app.whenStable()
    expect(app.element.querySelector('h1')?.textContent).toBe('signed-out')
    graceReady.resolve()
    await vi.waitFor(() => {
      expect(destroyed).toHaveBeenCalledWith('grace')
    })
    expect(app.element.querySelector('h1')?.textContent).toBe('signed-out')
    expect(app.environment.diagnostics).toHaveLength(0)
    expect(app.element.querySelectorAll('h1')).toHaveLength(1)
  })

  it('finishes the newest session when identity changes before the first application mounts', async () => {
    const adaReady = deferred<void>()
    const started = vi.fn()
    const destroyed = vi.fn()
    const definition = createApp({
      id: 'initial-session',
      providers: [
        provideAppInitializer(() => {
          const user = injectMfeRuntime().shellState.getUser()?.id
          started(user)
          inject(DestroyRef).onDestroy(() => {
            destroyed(user)
          })
          return user === 'ada' ? adaReady.promise : undefined
        }),
      ],
      routes: [
        {
          path: '',
          component: SessionRoute,
          resolve: { private: () => String(injectMfeRuntime().shellState.getUser()?.id) },
        },
      ],
    })
    const environment = createMfeTestEnvironment({
      definitions: [definition],
      initialEntries: ['/initial-session'],
      shellState: { user: { id: 'ada', name: 'Ada' } },
    })
    const handle = createMountContext({
      runtime: environment.runtime,
      definitionId: definition.id,
      kind: 'app',
      basePath: '/initial-session',
    })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const failed = vi.fn()
    const mounting = definition.mount({ element, context: handle.context, onFailure: failed })
    await vi.waitFor(() => {
      expect(started).toHaveBeenCalledWith('ada')
    })
    environment.setShellState({ user: { id: 'grace', name: 'Grace' } })
    const mounted = await mounting
    await mounted.whenStable?.()
    expect(element.querySelector('h1')?.textContent).toBe('grace')
    adaReady.resolve()
    await vi.waitFor(() => {
      expect(destroyed).toHaveBeenCalledWith('ada')
    })
    expect(element.querySelector('h1')?.textContent).toBe('grace')
    expect(failed).not.toHaveBeenCalled()
    await mounted.dispose()
    await handle.dispose()
    element.remove()
    environment.dispose()
  })

  it('shares one Widget session signal and cancels pending HttpClient results when permissions change', async () => {
    @Component({ selector: 'test-session-widget', template: '<h1>{{ session().generation }}</h1>' })
    class SessionWidget {
      readonly session = injectSession()
      readonly sameSession = injectSession()
      readonly http = inject(HttpClient)
    }
    const interceptor = createMfeHttpAuthInterceptor({
      apiOrigins: ['https://api.example.test'],
      getAccessToken: async () => 'token',
    })
    const definition = createWidget({
      id: 'session-widget',
      component: SessionWidget,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      providers: [provideHttpClient(withInterceptors([interceptor]))],
    })
    const widget = await mountWidget(definition, {
      shellState: { user: { id: 'ada', name: 'Ada' }, groups: ['admin'] },
    })
    const session = runInInjectionContext(widget.injector, injectSession)
    const same = runInInjectionContext(widget.injector, injectSession)
    expect(same).toBe(session)
    const first = session()
    let deliver = () => undefined
    const received = vi.fn()
    const completed = vi.fn()
    const stopped = vi.fn()
    const backendStarted = vi.fn()
    const response = runInInjectionContext(widget.injector, () =>
      interceptor(
        new HttpRequest('GET', 'https://api.example.test/jobs'),
        () =>
          new Observable(subscriber => {
            backendStarted()
            deliver = () => {
              subscriber.next(new HttpResponse({ body: 'old response' }))
              subscriber.complete()
            }
            return stopped
          }),
      ),
    )
    response.subscribe({ next: received, complete: completed })
    await vi.waitFor(() => {
      expect(backendStarted).toHaveBeenCalledOnce()
    })
    widget.environment.setShellState({ groups: ['reader'] })
    expect(first.signal.aborted).toBe(true)
    expect(session().generation).toBe(1)
    expect(completed).toHaveBeenCalledOnce()
    expect(stopped).toHaveBeenCalledOnce()
    deliver()
    expect(received).not.toHaveBeenCalled()
    await widget.whenStable()
    expect(widget.element.querySelector('h1')?.textContent).toBe('1')
    const active = session()
    await widget.dispose()
    expect(active.signal.aborted).toBe(true)
  })
})
