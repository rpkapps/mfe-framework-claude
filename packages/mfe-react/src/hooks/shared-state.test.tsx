import { act, renderHook } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { createMemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { StrictMode, type ReactNode } from 'react'
import type {
  SharedStateAdapter,
  SharedStateStore,
  StateContract,
} from '@company/mfe-core/shared-state'
import { createMountContext } from '@company/mfe-runtime'
import { createMemoryRuntime } from '@company/mfe-runtime/testing'
import { prepareSharedStateMount } from '@company/mfe-runtime/shared-state'
import { createRouterContext } from '../app-mount.tsx'
import { createApp } from '../definition.ts'
import { MfeMountProvider } from '../mount-context.tsx'
import type { AppRouterOptions, MfeRouterContext } from '../router-contract.ts'
import { withQueryClient } from '../runtime.ts'
import { mountApp } from '../testing/index.tsx'
import { createSharedStateBindings } from './shared-state.ts'

interface Values {
  units: 'metric' | 'imperial'
}
const contract: StateContract = {
  formatVersion: 1,
  id: 'units',
  revision: 'units',
  node: {
    kind: 'default',
    inner: { kind: 'enum', values: ['metric', 'imperial'] },
    value: 'metric',
  },
}
const requirements = {
  protocolVersion: 1 as const,
  contracts: [{ id: 'units', revision: 'units' }],
}
const bindings = createSharedStateBindings<Values>('reader')
function adapter(): SharedStateAdapter {
  let record: {
    id: string
    revision: number
    value?: 'metric' | 'imperial'
  } = { id: 'units', revision: 0 }
  return {
    hydrate: () => Promise.resolve([record]),
    write: operation => {
      if (operation.expectedRevision !== record.revision)
        return Promise.reject(new Error('conflict'))
      record = {
        id: 'units',
        revision: record.revision + 1,
        value: operation.value as Values['units'],
      }
      return Promise.resolve(record)
    },
  }
}
async function setup() {
  const memory = createMemoryRuntime({
    sharedState: {
      scope: 'user/workspace',
      contracts: { formatVersion: 1, contracts: [contract] },
      adapter: adapter(),
    },
  })
  const context = createMountContext({
    runtime: memory.runtime,
    definitionId: 'reader',
    kind: 'app',
    basePath: '/',
  })
  const prepared = await prepareSharedStateMount(
    { id: 'reader', sharedState: requirements },
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
describe('definition-bound React shared state and routers', () => {
  it('returns typed state/setter, updates all consumers and keeps callbacks stable under StrictMode', async () => {
    const environment = await setup()
    const first = renderHook(() => bindings.useSharedState('units'), {
      wrapper: environment.wrapper,
    })
    const second = renderHook(() => bindings.useSharedState('units'), {
      wrapper: environment.wrapper,
    })
    const setter = first.result.current[1]
    await act(async () => {
      await setter('imperial')
    })
    expect(first.result.current[0]).toBe('imperial')
    expect(second.result.current[0]).toBe('imperial')
    expect(first.result.current[1]).toBe(setter)
    first.unmount()
    second.unmount()
    await environment.dispose()
  })
  it('uses the same live store in TanStack router loaders and React hooks', async () => {
    const environment = await setup()
    const context = createRouterContext<Values>(environment.mount)
    const root = createRootRouteWithContext<MfeRouterContext<Values>>()({})
    const index = createRoute({
      getParentRoute: () => root,
      path: '/',
      loader: ({ context: routeContext }) => routeContext.mfe.sharedState.get('units'),
    })
    const router = createRouter({
      routeTree: root.addChildren([index]),
      context,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await router.load()
    expect(router.state.matches.at(-1)?.loaderData).toBe('metric')
    await context.mfe.sharedState.set('units', 'imperial')
    await router.invalidate()
    expect(router.state.matches.at(-1)?.loaderData).toBe('imperial')
    await environment.dispose()
  })
  it('supports React Router data loaders and actions without hooks or a module singleton', async () => {
    const environment = await setup()
    const store = bindingsStore(environment.mount.sharedState!)
    const router = createMemoryRouter(
      [
        {
          path: '/',
          loader: () => store.get('units'),
          action: async () => {
            await store.set('units', 'imperial')
            return store.get('units')
          },
        },
      ],
      { initialEntries: ['/'] },
    )
    await vi.waitFor(() => expect(router.state.loaderData['0']).toBe('metric'))
    await router.navigate('/', { formMethod: 'post', formData: new FormData() })
    expect(router.state.actionData?.['0']).toBe('imperial')
    expect(router.state.loaderData['0']).toBe('imperial')
    expect(environment.mount.sharedState!.get('units')).toBe('imperial')
    router.dispose()
    await environment.dispose()
  })
  it('hydrates before calling an app router factory and reports unsupported shells before render', async () => {
    const factory = vi.fn(({ basePath, history, context }: AppRouterOptions<Values>) => {
      expect(context.mfe.sharedState.get('units')).toBe('metric')
      return createRouter({
        basepath: basePath,
        history,
        context,
        routeTree: createRootRouteWithContext<MfeRouterContext<Values>>()({}).addChildren([]),
      })
    })
    const definition = createApp({ id: 'reader', sharedState: requirements, router: factory })
    const mounted = await mountApp(definition, {
      sharedState: {
        scope: 'user/workspace',
        contracts: { formatVersion: 1, contracts: [contract] },
        adapter: adapter(),
      },
    })
    expect(factory).toHaveBeenCalled()
    await mounted.dispose()
    await expect(mountApp(definition)).rejects.toThrow('shared-state')
  })
  it('rejects a binding from another definition', async () => {
    const environment = await setup()
    const other = createSharedStateBindings<Values>('other')
    expect(() =>
      renderHook(() => other.useSharedState('units'), { wrapper: environment.wrapper }),
    ).toThrow('generated binding')
    await environment.dispose()
  })
})
function bindingsStore(store: SharedStateStore): SharedStateStore<Values> {
  return store as unknown as SharedStateStore<Values>
}
