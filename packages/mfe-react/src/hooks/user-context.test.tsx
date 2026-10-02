import { stateCapabilities } from '@company/mfe-core/user-context'
import { act, render, renderHook } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { Component, StrictMode, type ReactNode } from 'react'
import type {
  UserContextAdapter,
  UserContextScopeService,
  StateContract,
} from '@company/mfe-core/user-context'
import { createMountContext } from '@company/mfe-runtime'
import { createMemoryRuntime } from '@company/mfe-runtime/testing'
import { prepareUserContextMount } from '@company/mfe-runtime/user-context'
import { createRouterContext } from '../app-mount.tsx'
import { createApp } from '../definition.ts'
import { MfeMountProvider } from '../mount-context.tsx'
import type { AppRouterOptions, MfeRouterContext } from '../router-contract.ts'
import { withQueryClient } from '../runtime.ts'
import { mountApp } from '../testing/index.tsx'
import { createUserContextBindings } from './user-context.ts'

type Values = {
  units: 'metric' | 'imperial'
}
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
const bindings = createUserContextBindings<Values>('reader')
function adapter(): UserContextAdapter {
  let record: {
    id: string
    revision: number
    value?: { units: 'metric' | 'imperial' }
  } = { id: 'reader', revision: 0 }
  return {
    hydrate: () => Promise.resolve([record]),
    write: operation => {
      if (operation.expectedRevision !== record.revision)
        return Promise.reject(new Error('conflict'))
      record = {
        id: 'reader',
        revision: record.revision + 1,
        value: operation.value as unknown as Values,
      }
      return Promise.resolve(record)
    },
  }
}
async function setup() {
  const memory = createMemoryRuntime({
    userContext: {
      scope: 'user/workspace',
      schema: { formatVersion: 1, contracts: [contract] },
      adapter: adapter(),
    },
  })
  const context = createMountContext({
    runtime: memory.runtime,
    definitionId: 'reader',
    kind: 'app',
    basePath: '/',
  })
  const prepared = await prepareUserContextMount(
    { id: 'reader', userContext: requirements },
    context.context,
  )
  const mount = withQueryClient(prepared)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <MfeMountProvider mount={mount}>{children}</MfeMountProvider>
    </StrictMode>
  )
  return {
    memory,
    mount,
    wrapper,
    dispose: async () => {
      await context.dispose()
      memory.dispose()
    },
  }
}
describe('definition-bound React user context and routers', () => {
  it('returns a typed owner store, updates all consumers and keeps callbacks stable under StrictMode', async () => {
    const environment = await setup()
    const first = renderHook(() => bindings.useUserContext(), {
      wrapper: environment.wrapper,
    })
    const second = renderHook(() => bindings.useUserContext(), {
      wrapper: environment.wrapper,
    })
    const setter = first.result.current.set
    const order: string[] = []
    const unsubscribe = first.result.current.subscribe('units', () => {
      order.push(first.result.current.get('units'))
    })
    await act(async () => {
      expect(await setter('units', 'imperial')).toEqual({ ok: true, value: 'imperial' })
      order.push('acknowledged')
    })
    expect(first.result.current.get('units')).toBe('imperial')
    expect(second.result.current.get('units')).toBe('imperial')
    expect(first.result.current.set).toBe(setter)
    expect(order).toEqual(['imperial', 'acknowledged'])
    unsubscribe()
    first.unmount()
    second.unmount()
    await environment.dispose()
  })
  it('reactively reads a declared foreign owner without exposing a setter', async () => {
    const environment = await setup()
    const observerContext = createMountContext({
      runtime: environment.memory.runtime,
      definitionId: 'observer',
      kind: 'app',
      basePath: '/',
    })
    const prepared = await prepareUserContextMount(
      { id: 'observer', userContext: { ...requirements, ownerId: 'observer' } },
      observerContext.context,
    )
    const observerMount = withQueryClient(prepared)
    const observer = createUserContextBindings<Record<string, never>>('observer')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <MfeMountProvider mount={observerMount}>{children}</MfeMountProvider>
      </StrictMode>
    )
    const read = renderHook(
      () => {
        const store = observer.useUserContext<Values>('reader')
        return { store, units: store.get('units') }
      },
      { wrapper },
    )
    expect(read.result.current.units).toBe('metric')
    expect('set' in read.result.current.store).toBe(false)
    expectTypeOf(read.result.current.store).not.toHaveProperty('set')
    await act(async () => {
      await environment.mount.userContext!.set('units', 'imperial')
    })
    expect(read.result.current.units).toBe('imperial')
    expect(() => observerMount.resolveUserContext!('undeclared')).toThrow()
    read.unmount()
    await observerContext.dispose()
    await environment.dispose()
  })
  it('keeps committed values when validation fails and returns the canonical error result', async () => {
    const environment = await setup()
    const consumer = renderHook(() => bindings.useUserContext(), { wrapper: environment.wrapper })
    const listener = vi.fn()
    const unsubscribe = consumer.result.current.subscribe('units', listener)
    const result = await consumer.result.current.set('units', 'invalid' as Values['units'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('user-context/invalid-value')
    expect(consumer.result.current.get('units')).toBe('metric')
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
    consumer.unmount()
    await environment.dispose()
  })
  it('replaces the old scope display with an error boundary when the identity changes', async () => {
    const environment = await setup()
    class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
      override state = { error: null as Error | null }
      static getDerivedStateFromError(error: Error) {
        return { error }
      }
      override render() {
        return this.state.error ? <span>{this.state.error.message}</span> : this.props.children
      }
    }
    function Reader() {
      return <span>{bindings.useUserContext().get('units')}</span>
    }
    const view = render(
      <Boundary>
        <Reader />
      </Boundary>,
      { wrapper: environment.wrapper },
    )
    expect(view.container.textContent).toBe('metric')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      act(() => {
        ;(environment.memory.runtime.userContext as UserContextScopeService).setScope(
          'another-user',
        )
      })
      expect(view.container.textContent).not.toContain('metric')
      expect(view.container.textContent).toContain('scope')
    } finally {
      consoleError.mockRestore()
      view.unmount()
      await environment.dispose()
    }
  })
  it('uses the same live store in TanStack router loaders and React hooks', async () => {
    const environment = await setup()
    const context = createRouterContext<Values>(environment.mount)
    const root = createRootRouteWithContext<MfeRouterContext<Values>>()({})
    const index = createRoute({
      getParentRoute: () => root,
      path: '/',
      loader: ({ context: routeContext }) => routeContext.mfe.userContext.get('units'),
    })
    const router = createRouter({
      routeTree: root.addChildren([index]),
      context,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await router.load()
    expect(router.state.matches.at(-1)?.loaderData).toBe('metric')
    await context.mfe.userContext.set('units', 'imperial')
    await router.invalidate()
    expect(router.state.matches.at(-1)?.loaderData).toBe('imperial')
    await environment.dispose()
  })
  it('hydrates before calling an app router factory and reports unsupported shells before render', async () => {
    const factory = vi.fn(({ basePath, history, context }: AppRouterOptions<Values>) => {
      expect(context.mfe.userContext.get('units')).toBe('metric')
      return createRouter({
        basepath: basePath,
        history,
        context,
        routeTree: createRootRouteWithContext<MfeRouterContext<Values>>()({}).addChildren([]),
      })
    })
    const definition = createApp({ id: 'reader', userContext: requirements, router: factory })
    const mounted = await mountApp(definition, {
      userContext: {
        scope: 'user/workspace',
        schema: { formatVersion: 1, contracts: [contract] },
        adapter: adapter(),
      },
    })
    expect(factory).toHaveBeenCalled()
    await mounted.dispose()
    await expect(mountApp(definition)).rejects.toThrow('user-context')
  })
  it('rejects a binding from another definition', async () => {
    const environment = await setup()
    const other = createUserContextBindings<Values>('other')
    expect(() =>
      renderHook(() => other.useUserContext(), { wrapper: environment.wrapper }),
    ).toThrow('generated binding')
    await environment.dispose()
  })
})
