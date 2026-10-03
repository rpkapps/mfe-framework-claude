import { applyStateWrite, normalize, stateCapabilities } from '@company/mfe-core/user-context'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { Component, StrictMode, Suspense, useMemo, useEffect, type ReactNode } from 'react'
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
import { createHostUserContextBindings, createUserContextBindings } from './user-context.ts'
import { MfeProvider } from '../runtime-context.tsx'

type Values = {
  units: 'metric' | 'imperial'
  preferences: { appearance: { theme: string; fontSize: number } }
}
const contract: StateContract = {
  formatVersion: 1,
  id: 'reader',
  revision: 'reader-v1',
  node: {
    kind: 'object',
    strict: true,
    fields: {
      preferences: {
        kind: 'default',
        inner: {
          kind: 'object',
          strict: true,
          fields: {
            appearance: {
              kind: 'object',
              strict: true,
              fields: {
                theme: { kind: 'string' },
                fontSize: { kind: 'number' },
              },
            },
          },
        },
        value: { appearance: { theme: 'light', fontSize: 14 } },
      },
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
    value?: Values
  } = { id: 'reader', revision: 0 }
  return {
    hydrate: () => Promise.resolve([record]),
    write: operation => {
      if (operation.expectedRevision !== record.revision)
        return Promise.reject(new Error('conflict'))
      record = {
        id: 'reader',
        revision: record.revision + 1,
        value: applyStateWrite(
          contract,
          normalize(contract.node, record.value, contract.id),
          operation.value,
        ) as unknown as Values,
      }
      return Promise.resolve(record)
    },
  }
}
async function setup(persistence: UserContextAdapter = adapter()) {
  const memory = createMemoryRuntime({
    userContext: {
      scope: 'user/workspace',
      schema: { formatVersion: 1, contracts: [contract] },
      adapter: persistence,
    },
  })
  const context = createMountContext({
    runtime: memory.runtime,
    definitionId: 'reader',
    kind: 'app',
    basePath: '/',
  })
  const prepared = await prepareUserContextMount(
    { id: 'reader', __userContext: requirements },
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
  it('updates selected render values and memoized consumers while keeping the setter stable', async () => {
    const environment = await setup()
    const consumer = renderHook(
      () => {
        const selection = bindings.useUserContext(ctx => ctx.units)
        const units = useMemo(() => selection[0], [selection])
        return { selection, units }
      },
      { wrapper: environment.wrapper },
    )
    const initial = consumer.result.current
    expect(initial.units).toBe('metric')
    consumer.rerender()
    expect(consumer.result.current.selection).toBe(initial.selection)
    await act(async () => {
      expect(await initial.selection[1]('units', 'imperial')).toEqual({
        ok: true,
        value: 'imperial',
      })
    })
    expect(consumer.result.current.units).toBe('imperial')
    expect(consumer.result.current.selection).not.toBe(initial.selection)
    expect(consumer.result.current.selection[1]).toBe(initial.selection[1])
    consumer.unmount()
    await environment.dispose()
  })
  it('skips sibling writes for nested selectors and automatically unsubscribes under StrictMode', async () => {
    const environment = await setup()
    const selector = vi.fn((ctx: Readonly<Values>) => ctx.preferences.appearance.theme)
    const rendered = vi.fn()
    const consumer = renderHook(
      () => {
        rendered()
        return bindings.useUserContext(selector)
      },
      { wrapper: environment.wrapper },
    )
    selector.mockClear()
    rendered.mockClear()
    await act(async () => {
      await consumer.result.current[1]('preferences', { appearance: { fontSize: 18 } })
      await consumer.result.current[1]('units', 'imperial')
    })
    expect(selector).not.toHaveBeenCalled()
    expect(rendered).not.toHaveBeenCalled()
    await act(async () => {
      await consumer.result.current[1]('preferences', { appearance: { theme: 'dark' } })
    })
    expect(consumer.result.current[0]).toBe('dark')
    expect(rendered).toHaveBeenCalled()
    consumer.unmount()
    selector.mockClear()
    await environment.mount.userContext!.set('preferences', { appearance: { theme: 'light' } })
    expect(selector).not.toHaveBeenCalled()
    await environment.dispose()
  })
  it('uses updated selector closures without retaining the old selection', async () => {
    const environment = await setup()
    const consumer = renderHook(
      ({ suffix }) => bindings.useUserContext(ctx => ctx.units + suffix),
      {
        initialProps: { suffix: '-first' },
        wrapper: environment.wrapper,
      },
    )
    expect(consumer.result.current[0]).toBe('metric-first')
    consumer.rerender({ suffix: '-second' })
    expect(consumer.result.current[0]).toBe('metric-second')
    await act(async () => {
      await consumer.result.current[1]('units', 'imperial')
    })
    expect(consumer.result.current[0]).toBe('imperial-second')
    consumer.unmount()
    await environment.dispose()
  })
  it('keeps an inline derived selection referentially stable across rerenders', async () => {
    const environment = await setup()
    const consumer = renderHook(
      () => bindings.useUserContext(ctx => ({ theme: ctx.preferences.appearance.theme })),
      { wrapper: environment.wrapper },
    )
    const initial = consumer.result.current
    consumer.rerender()
    expect(consumer.result.current).toBe(initial)
    await act(async () => {
      await initial[1]('preferences', { appearance: { theme: 'dark' } })
    })
    expect(consumer.result.current[0]).toEqual({ theme: 'dark' })
    consumer.unmount()
    await environment.dispose()
  })
  it('moves subscriptions when a new selector reads a different field', async () => {
    const environment = await setup()
    const rendered = vi.fn()
    const consumer = renderHook(
      ({ field }: { field: 'theme' | 'units' }) => {
        rendered()
        return bindings.useUserContext(ctx =>
          field === 'theme' ? ctx.preferences.appearance.theme : ctx.units,
        )
      },
      { initialProps: { field: 'theme' }, wrapper: environment.wrapper },
    )
    expect(consumer.result.current[0]).toBe('light')
    consumer.rerender({ field: 'units' })
    expect(consumer.result.current[0]).toBe('metric')
    rendered.mockClear()
    await act(async () => {
      await consumer.result.current[1]('preferences', { appearance: { theme: 'dark' } })
    })
    expect(rendered).not.toHaveBeenCalled()
    await act(async () => {
      await consumer.result.current[1]('units', 'imperial')
    })
    expect(consumer.result.current[0]).toBe('imperial')
    consumer.unmount()
    await environment.dispose()
  })
  it('reactively reads a declared foreign owner with inferred types and no setter', async () => {
    const environment = await setup()
    const observerContext = createMountContext({
      runtime: environment.memory.runtime,
      definitionId: 'observer',
      kind: 'app',
      basePath: '/',
    })
    const prepared = await prepareUserContextMount(
      { id: 'observer', __userContext: { ...requirements, ownerId: 'observer' } },
      observerContext.context,
    )
    const observerMount = withQueryClient(prepared)
    const observer = createUserContextBindings<Record<string, never>, { reader: Values }>(
      'observer',
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <MfeMountProvider mount={observerMount}>{children}</MfeMountProvider>
      </StrictMode>
    )
    const read = renderHook(() => observer.useUserContext('reader', ctx => ctx.units), { wrapper })
    expect(read.result.current).toEqual(['metric'])
    expectTypeOf(read.result.current).toEqualTypeOf<readonly [Values['units']]>()
    // @ts-expect-error: Foreign bindings have no writer, including through tuple destructuring.
    const [, foreignSet] = read.result.current
    expect(foreignSet).toBeUndefined()
    await act(async () => {
      await environment.mount.userContext!.set('units', 'imperial')
    })
    expect(read.result.current).toEqual(['imperial'])
    expect(() => observerMount.resolveUserContext!('undeclared')).toThrow()
    read.unmount()
    await observerContext.dispose()
    await environment.dispose()
  })
  it('disconnects a previous owner when the owner argument changes', async () => {
    const first = await setup()
    const second = await setup()
    await second.mount.userContext!.set('units', 'imperial')
    const readers = { first: first.mount.userContext!, second: second.mount.userContext! }
    const mount = {
      ...first.mount,
      resolveUserContext: (ownerId: string) => readers[ownerId as keyof typeof readers],
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MfeMountProvider mount={mount}>{children}</MfeMountProvider>
    )
    const observer = createUserContextBindings<Values, { first: Values; second: Values }>('reader')
    const rendered = vi.fn()
    const consumer = renderHook(
      ({ owner }: { owner: 'first' | 'second' }) => {
        rendered()
        return observer.useUserContext(owner, ctx => ctx.units)
      },
      { initialProps: { owner: 'first' }, wrapper },
    )
    expect(consumer.result.current).toEqual(['metric'])
    consumer.rerender({ owner: 'second' })
    expect(consumer.result.current).toEqual(['imperial'])
    rendered.mockClear()
    await act(async () => {
      await first.mount.userContext!.set('units', 'imperial')
    })
    expect(rendered).not.toHaveBeenCalled()
    await act(async () => {
      await second.mount.userContext!.set('units', 'metric')
    })
    expect(consumer.result.current).toEqual(['metric'])
    consumer.unmount()
    await first.dispose()
    await second.dispose()
  })
  it('keeps committed selections when validation fails and returns the canonical error result', async () => {
    const environment = await setup()
    const consumer = renderHook(() => bindings.useUserContext(ctx => ctx.units), {
      wrapper: environment.wrapper,
    })
    const result = await consumer.result.current[1]('units', 'invalid' as Values['units'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('user-context/invalid-value')
    expect(consumer.result.current[0]).toBe('metric')
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
      return <span>{bindings.useUserContext(ctx => ctx.units)[0]}</span>
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
    const definition = createApp({ id: 'reader', __userContext: requirements, router: factory })
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
      renderHook(() => other.useUserContext(ctx => ctx.units), { wrapper: environment.wrapper }),
    ).toThrow('generated binding')
    await environment.dispose()
  })
})

// Compile-time public API coverage; this component is intentionally never mounted.
function TypeContracts() {
  const [units, set] = bindings.useUserContext(ctx => ctx.units)
  expectTypeOf(units).toEqualTypeOf<Values['units']>()
  void set('preferences', { appearance: { theme: 'dark' } })
  // @ts-expect-error: Writes retain the generated field value type.
  void set('units', 'invalid')
  // @ts-expect-error: Unknown fields cannot be written.
  void set('missing', true)
  // @ts-expect-error: Selectors are required; there is no broad no-argument store hook.
  bindings.useUserContext()
  // @ts-expect-error: Undeclared foreign owners cannot be read.
  bindings.useUserContext('unknown', () => null)
  expectTypeOf(bindings).not.toHaveProperty('useUserContextStore')
  return null
}
void TypeContracts

describe('generated React shell user-context binding', () => {
  it('hydrates automatically, selects narrowly, and cleans subscriptions on unmount', async () => {
    const environment = await setup()
    const host = createHostUserContextBindings<Values>(requirements)
    const rendered = vi.fn()
    function Consumer() {
      const [theme] = host.useUserContext(value => value.preferences.appearance.theme)
      rendered(theme)
      return <span>{theme}</span>
    }
    const component = render(
      <MfeProvider runtime={environment.memory.runtime}>
        <Suspense fallback={<span>Loading</span>}>
          <Consumer />
        </Suspense>
      </MfeProvider>,
    )
    await waitFor(() => expect(component.getByText('light')).toBeTruthy())
    rendered.mockClear()
    await act(async () => {
      await environment.mount.userContext!.set('preferences', { appearance: { fontSize: 20 } })
    })
    expect(rendered).not.toHaveBeenCalled()
    await act(async () => {
      await environment.mount.userContext!.set('preferences', { appearance: { theme: 'dark' } })
    })
    expect(component.getByText('dark')).toBeTruthy()
    component.unmount()
    rendered.mockClear()
    await environment.mount.userContext!.set('units', 'imperial')
    expect(rendered).not.toHaveBeenCalled()
    await environment.dispose()
  })

  it('routes hydration failures to a local boundary while the surrounding shell stays mounted', async () => {
    const environment = await setup()
    const service = environment.memory.runtime.userContext!
    vi.spyOn(service, 'prepare').mockRejectedValue(new Error('Preferences API unavailable'))
    const host = createHostUserContextBindings<Values>(requirements)
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      override state = { failed: false }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      override render() {
        return this.state.failed ? <span>Preferences unavailable</span> : this.props.children
      }
    }
    function Consumer() {
      const [theme] = host.useUserContext(value => value.preferences.appearance.theme)
      return <span>{theme}</span>
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const component = render(
      <MfeProvider runtime={environment.memory.runtime}>
        <span>Shell navigation</span>
        <Boundary>
          <Suspense fallback={<span>Loading</span>}>
            <Consumer />
          </Suspense>
        </Boundary>
      </MfeProvider>,
    )
    try {
      await waitFor(() => expect(component.getByText('Preferences unavailable')).toBeTruthy())
      expect(component.getByText('Shell navigation')).toBeTruthy()
      expect(service.prepare).toHaveBeenCalledTimes(1)
    } finally {
      component.unmount()
      consoleError.mockRestore()
      await environment.dispose()
    }
  })

  it('rebinds after user scope changes and never keeps the previous user value', async () => {
    const persistence = adapter()
    const environment = await setup({
      ...persistence,
      hydrate: (scope, ids, signal) =>
        scope === 'next-user'
          ? Promise.resolve([{ id: 'reader', revision: 0 }])
          : persistence.hydrate(scope, ids, signal),
    })
    await environment.mount.userContext!.set('units', 'imperial')
    const service = environment.memory.runtime.userContext as UserContextScopeService
    const host = createHostUserContextBindings<Values>(requirements)
    let latest: ReturnType<typeof service.bind<Values>>['set'] | undefined
    function Consumer() {
      const [units, set] = host.useUserContext(value => value.units)
      useEffect(() => {
        latest = set
      }, [set])
      return <span>{units}</span>
    }
    const component = render(
      <MfeProvider runtime={environment.memory.runtime}>
        <Suspense fallback={<span>Loading</span>}>
          <Consumer />
        </Suspense>
      </MfeProvider>,
    )
    await waitFor(() => expect(component.getByText('imperial')).toBeTruthy())
    const oldSet = latest!
    await act(async () => {
      service.setScope('next-user')
    })
    await waitFor(() => expect(component.getByText('metric')).toBeTruthy())
    expect(latest).not.toBe(oldSet)
    expect(await oldSet('units', 'metric')).toMatchObject({
      ok: false,
      error: { code: 'user-context/scope-disposed' },
    })
    component.unmount()
    await environment.dispose()
  })
})
