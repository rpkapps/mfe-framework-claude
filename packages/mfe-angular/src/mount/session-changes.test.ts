import {
  HttpClient,
  HttpRequest,
  HttpResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http'
import { Component, inject, runInInjectionContext, signal } from '@angular/core'
import { ActivatedRoute, type Routes } from '@angular/router'
import { mountDefinition } from '@company/mfe-runtime'
import { Observable } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget } from '../definition.ts'
import { createMfeHttpAuthInterceptor } from '../http/auth-interceptor.ts'
import { injectSession } from '../inject/session.ts'
import { injectMfeRuntime } from '../inject/runtime.ts'
import { createMfeTestEnvironment, mountApp, mountWidget } from '../testing/index.ts'

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
  it('reruns guards/resolvers without adding history and preserves normal authored route policies', async () => {
    const resolve = vi.fn(() => {
      const state = injectMfeRuntime().shellState.getSnapshot()
      return `${state.user?.id ?? 'signed-out'}:${state.groups.join(',')}`
    })
    const ordinaryPolicy = vi.fn(() => false)
    const routes: Routes = [
      {
        path: '',
        component: SessionRoute,
        resolve: { private: resolve },
        runGuardsAndResolvers: ordinaryPolicy,
      },
    ]
    const definition = createApp({ id: 'session-routes', routes })
    const app = await mountApp(definition, {
      basePath: '/session-routes',
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
    expect(routes[0]?.runGuardsAndResolvers).toBe(ordinaryPolicy)
    app.environment.setShellState({ user: null, groups: [] })
    await vi.waitFor(() => {
      expect(app.element.querySelector('h1')?.textContent).toBe('signed-out:')
    })
    app.environment.setShellState({ theme: 'dark' })
    await app.whenStable()
    expect(resolve).toHaveBeenCalledTimes(3)
  })

  it('hides previous-session route data while refreshing and prevents superseded resolver results from surfacing', async () => {
    const oldRefresh = deferred<string>()
    const newRefresh = deferred<string>()
    const definition = createApp({
      id: 'pending-session',
      routes: [
        {
          path: '',
          component: SessionRoute,
          resolve: {
            private: () => {
              const user = injectMfeRuntime().shellState.getUser()
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
    app.environment.setShellState({ user: { id: 'grace', name: 'Grace' } })
    expect(app.element.querySelector('[hidden]')).not.toBeNull()
    expect(getComputedStyle(app.element.querySelector('[hidden]')!).display).toBe('none')
    // Let Angular start the old refresh so this tests cancellation of a real pending resolver.
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0)
    })
    app.environment.setShellState({ user: null })
    oldRefresh.resolve('Grace obsolete data')
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0)
    })
    expect(app.element.querySelector('[hidden]')).not.toBeNull()
    expect(app.element.querySelector('h1')?.textContent).not.toBe('Grace obsolete data')
    newRefresh.resolve('Signed-out data')
    await vi.waitFor(() => {
      expect(app.element.querySelector('h1')?.textContent).toBe('Signed-out data')
    })
    expect(app.element.querySelector('[hidden]')).toBeNull()
    expect(getComputedStyle(app.element.firstElementChild!).display).toBe('contents')
  })

  it('refreshes nested lazy route resolvers as well as eagerly authored routes', async () => {
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

  it('fails locally if the new session cannot pass a route guard, keeping old data hidden', async () => {
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
      expect(mounted.state.error.operation).toBe('refresh routes after a session change')
    expect(element.textContent).not.toContain('Privileged data')
    await mounted.dispose()
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
