import { stateCapabilities } from '@company/mfe-core/user-context'
import { Component, createEnvironmentInjector, runInInjectionContext } from '@angular/core'
import { Router } from '@angular/router'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import type {
  UserContextAdapter,
  UserContextScopeService,
  StateContract,
} from '@company/mfe-core/user-context'
import { createApp, createWidget } from '../definition.ts'
import { createMfeTestEnvironment, mountApp, mountWidget } from '../testing/index.ts'
import { createUserContextBindings } from './user-context.ts'

type Values = {
  units: 'metric' | 'imperial'
}
const bindings = createUserContextBindings<Values>('reader')
const contract: StateContract = {
  formatVersion: 1,
  id: 'reader',
  revision: 'reader-v1',
  node: {
    kind: 'object',
    strict: true,
    fields: {
      units: {
        kind: 'default',
        inner: { kind: 'enum', values: ['metric', 'imperial'] },
        value: 'metric',
      },
    },
  },
}
const requirements = {
  protocolVersion: 1 as const,
  ownerId: 'reader',
  contracts: [
    {
      id: contract.id,
      revision: contract.revision,
      capabilities: stateCapabilities(contract.node),
    },
  ],
}
function options() {
  let revision = 0
  let value: Values | undefined
  const adapter: UserContextAdapter = {
    hydrate: () =>
      Promise.resolve([
        value === undefined ? { id: 'reader', revision } : { id: 'reader', revision, value },
      ]),
    write: operation => {
      value = operation.value as unknown as Values
      return Promise.resolve({ id: 'reader', revision: ++revision, value })
    },
  }
  return {
    scope: 'user/workspace',
    schema: { formatVersion: 1 as const, contracts: [contract] },
    adapter,
  }
}
@Component({ selector: 'user-context-reader', template: '{{ context.get("units") }}' })
class ReaderComponent {
  readonly context = bindings.injectUserContext()
}

describe('definition-bound Angular user context', () => {
  it('renders reactive readonly signals and retains state on unmount/remount', async () => {
    const definition = createWidget({
      id: 'reader',
      userContext: requirements,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      component: ReaderComponent,
    })
    const environment = createMfeTestEnvironment({
      definitions: [definition],
      userContext: options(),
    })
    const mounted = await mountWidget(definition, { environment })
    expect(mounted.element.textContent).toContain('metric')
    const context = runInInjectionContext(mounted.injector, () => bindings.injectUserContext())
    expect(context.get('units')).toBe('metric')
    expect(await context.set('units', 'imperial')).toEqual({ ok: true, value: 'imperial' })
    await mounted.whenStable()
    expect(context.get('units')).toBe('imperial')
    expect(mounted.element.textContent).toContain('imperial')
    await mounted.dispose()
    const remounted = await mountWidget(definition, { environment })
    expect(remounted.element.textContent).toContain('imperial')
    await remounted.dispose()
    environment.dispose()
  })
  it('unsubscribes at injector destruction without deleting shell state', async () => {
    const definition = createWidget({
      id: 'reader',
      userContext: requirements,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      component: ReaderComponent,
    })
    const mounted = await mountWidget(definition, { userContext: options() })
    const child = createEnvironmentInjector([], mounted.injector)
    const context = runInInjectionContext(child, () => bindings.injectUserContext())
    const store = runInInjectionContext(mounted.injector, () => bindings.injectUserContextStore())
    child.destroy()
    await store.set('units', 'imperial')
    expect(context.get('units')).toBe('metric')
    expect(store.get('units')).toBe('imperial')
    await mounted.dispose()
  })
  it.each(['scope switch', 'mount disposal'] as const)(
    'rejects a saved binding after injector destruction followed by %s',
    async transition => {
      @Component({ selector: 'empty-reader', template: '' })
      class EmptyReader {}
      const definition = createWidget({
        id: 'reader',
        userContext: requirements,
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        component: EmptyReader,
      })
      const mounted = await mountWidget(definition, { userContext: options() })
      const child = createEnvironmentInjector([], mounted.injector)
      const context = runInInjectionContext(child, () => bindings.injectUserContext())
      expect(context.get('units')).toBe('metric')
      child.destroy()
      if (transition === 'scope switch') {
        ;(mounted.environment.runtime.userContext as UserContextScopeService).setScope(
          'another-user',
        )
      } else {
        await mounted.dispose()
      }
      expect(() => context.get('units')).toThrowError(
        expect.objectContaining({ code: 'user-context/scope-disposed' }),
      )
      if (transition === 'scope switch') await mounted.dispose()
    },
  )
  it('reads a declared foreign owner reactively without a setter', async () => {
    const owner = createWidget({
      id: 'reader',
      userContext: requirements,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      component: ReaderComponent,
    })
    const observerBindings = createUserContextBindings<Record<string, never>>('observer')
    @Component({ selector: 'context-observer', template: '{{ context.get("units") }}' })
    class ObserverComponent {
      readonly context = observerBindings.injectUserContext<Values>('reader')
    }
    const observer = createWidget({
      id: 'observer',
      userContext: { ...requirements, ownerId: 'observer' },
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      component: ObserverComponent,
    })
    const environment = createMfeTestEnvironment({
      definitions: [owner, observer],
      userContext: options(),
    })
    const mountedOwner = await mountWidget(owner, { environment })
    const mountedObserver = await mountWidget(observer, { environment })
    const foreign = runInInjectionContext(mountedObserver.injector, () =>
      observerBindings.injectUserContext<Values>('reader'),
    )
    expect('set' in foreign).toBe(false)
    expectTypeOf(foreign).not.toHaveProperty('set')
    expect(foreign.get('units')).toBe('metric')
    const store = runInInjectionContext(mountedOwner.injector, () =>
      bindings.injectUserContextStore(),
    )
    await store.set('units', 'imperial')
    await mountedObserver.whenStable()
    expect(foreign.get('units')).toBe('imperial')
    expect(mountedObserver.element.textContent).toContain('imperial')
    expect(() =>
      runInInjectionContext(mountedObserver.injector, () =>
        observerBindings.injectUserContextStore<Values>('undeclared'),
      ),
    ).toThrow()
    await mountedObserver.dispose()
    await mountedOwner.dispose()
    environment.dispose()
  })
  it('invalidates a mounted template when the user context scope changes', async () => {
    @Component({ selector: 'scope-reader', template: '{{ read() }}' })
    class ScopeReader {
      readonly context = bindings.injectUserContext()
      read() {
        try {
          return this.context.get('units')
        } catch (error) {
          return (error as { code: string }).code
        }
      }
    }
    const definition = createWidget({
      id: 'reader',
      userContext: requirements,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      component: ScopeReader,
    })
    const mounted = await mountWidget(definition, { userContext: options() })
    expect(mounted.element.textContent).toContain('metric')
    const service = mounted.environment.runtime.userContext as UserContextScopeService
    service.setScope('another-user')
    await mounted.whenStable()
    expect(mounted.element.textContent).not.toContain('metric')
    expect(mounted.element.textContent).toContain('user-context/scope-disposed')
    await mounted.dispose()
  })
  it('allows route resolvers and guards to access the prepared store', async () => {
    const resolver = vi.fn(() => bindings.injectUserContextStore().get('units'))
    const definition = createApp({
      id: 'reader',
      userContext: requirements,
      routes: [
        {
          path: '',
          component: ReaderComponent,
          canActivate: [() => bindings.injectUserContextStore().get('units') === 'metric'],
          resolve: { units: resolver },
        },
      ],
    })
    const mounted = await mountApp(definition, { userContext: options() })
    expect(resolver).toHaveBeenCalled()
    expect(mounted.injector.get(Router).routerState.snapshot.root.firstChild?.data['units']).toBe(
      'metric',
    )
    await mounted.dispose()
  })
  it('rejects wrong-definition and outside-injection-context access', () => {
    expect(() => bindings.injectUserContextStore()).toThrow()
  })
})
