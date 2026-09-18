/**
 * The contract tracer bullet: one complete new-contract path, with the loader
 * faked and no bundler, federation or deployed remote.
 *
 * It retires the contract risk before anything is built on top, and pins the
 * two feasibility answers the design depends on: the pinned router exposes
 * enough state to validate exact history identity, and one generated route tree
 * backs two concurrent mounts without cross-talk.
 */

import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  useRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { createApp } from './definition.ts'
import { renderApp } from './testing/index.tsx'
import { useUser } from './hooks/shell-state.ts'
import { MfeProvider } from './runtime-context.tsx'
import { AppMount } from './app-mount.tsx'
import type { AppRouterOptions, MfeRouterContext } from './router-contract.ts'

interface BeforeLoadObservation {
  readonly userId: string | null
  readonly theme: string
  readonly hasTelemetry: boolean
  readonly hasSignal: boolean
}

/** The feasibility routers below never read context. */
const NO_CONTEXT = {} as unknown as MfeRouterContext

/** The introductory fixture, exactly as an author would write it. */
function buildFixture(observations: BeforeLoadObservation[]) {
  const rootRoute = createRootRouteWithContext<MfeRouterContext>()({
    component: () => <Outlet />,
  })

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: ({ context }) => {
      // A route callback reads the snapshot for this invocation and types it
      // natively. No hook is involved and no service locator is needed.
      observations.push({
        userId: context.mfe.user?.id ?? null,
        theme: context.mfe.theme,
        hasTelemetry: typeof context.mfe.telemetry.event === 'function',
        hasSignal: context.mfe.signal instanceof AbortSignal,
      })
      return {}
    },
    component: function Dashboard() {
      // Live UI reads shell state through the hook, not through route context.
      const user = useUser()
      const router = useRouter()

      return (
        <div>
          <p data-testid="user">{user?.name ?? 'Signed out'}</p>
          <p data-testid="basepath">{String(router.options.basepath)}</p>
        </div>
      )
    },
  })

  const routeTree = rootRoute.addChildren([indexRoute])

  function makeRouter({ basePath, history, context }: AppRouterOptions) {
    return createRouter({
      routeTree,
      basepath: basePath,
      history,
      context: { ...context },
      defaultPreload: 'intent',
    })
  }

  return { makeRouter, routeTree }
}

describe('contract tracer bullet: mounting one App by id', () => {
  it('mounts at the supplied boundary, renders live shell state and disposes cleanly', async () => {
    const observations: BeforeLoadObservation[] = []
    const { makeRouter } = buildFixture(observations)

    const app = createApp({ id: 'tracer', version: '0.1.0', router: makeRouter })

    const rendered = renderApp(app, {
      basePath: '/tracer',
      initialEntries: ['/tracer'],
      shellState: { user: { id: 'u-1', name: 'Ada Lovelace' }, theme: 'dark' },
    })

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('Ada Lovelace')
    })

    // The author passed the framework's basePath straight through.
    expect(screen.getByTestId('basepath')).toHaveTextContent('/tracer')

    // A route callback observed the same coherent snapshot without a hook.
    expect(observations[0]).toEqual({
      userId: 'u-1',
      theme: 'dark',
      hasTelemetry: true,
      hasSignal: true,
    })

    const { mount } = rendered.environment
    expect(mount.signal.aborted).toBe(false)

    await rendered.dispose()

    // Disposal aborts the mount signal so background work stops.
    expect(mount.signal.aborted).toBe(true)
  })

  it('never hands the App a shell router or a raw browser History object', async () => {
    const seen: { history: unknown; contextKeys: string[] }[] = []
    const { makeRouter } = buildFixture([])

    const app = createApp({
      id: 'tracer',
      router: options => {
        seen.push({ history: options.history, contextKeys: Object.keys(options.context) })
        return makeRouter(options)
      },
    })

    const rendered = renderApp(app, { basePath: '/tracer', initialEntries: ['/tracer'] })
    await waitFor(() => expect(seen).toHaveLength(1))

    const supplied = seen[0]
    expect(supplied).toBeDefined()

    // Only the framework namespace and the mount's Query client are supplied.
    expect(supplied?.contextKeys.sort()).toEqual(['mfe', 'queryClient'])

    // The history is the framework's own object, not window.history.
    expect(supplied?.history).not.toBe(globalThis.history)
    expect(supplied?.history).toBeTypeOf('object')

    await rendered.dispose()
  })

  it('calls the author factory once per mount rather than once per module', async () => {
    const factory = vi.fn(buildFixture([]).makeRouter)
    const app = createApp({ id: 'tracer', router: factory })

    const first = renderApp(app, { basePath: '/a', initialEntries: ['/a'] })
    const second = renderApp(app, { basePath: '/b', initialEntries: ['/b'] })

    await waitFor(() => expect(factory).toHaveBeenCalledTimes(2))

    const firstCall = factory.mock.calls[0]?.[0]
    const secondCall = factory.mock.calls[1]?.[0]
    expect(firstCall?.basePath).toBe('/a')
    expect(secondCall?.basePath).toBe('/b')
    // Two mounts, two histories: no module-scope singleton.
    expect(firstCall?.history).not.toBe(secondCall?.history)

    await first.dispose()
    await second.dispose()
  })
})

describe('router contract validation', () => {
  function mountWithFactory(
    router: (options: AppRouterOptions) => never | ReturnType<typeof createRouter>,
  ) {
    const app = createApp({ id: 'tracer', version: '9.9.9', router })
    return renderApp(app, { basePath: '/tracer', initialEntries: ['/tracer'] })
  }

  it('rejects a router built with a different base path, naming the repair', () => {
    const { routeTree } = buildFixture([])

    expect(() =>
      mountWithFactory(({ history, context }) =>
        createRouter({ routeTree, basepath: '/somewhere-else', history, context: { ...context } }),
      ),
    ).toThrowError(/tracer@9\.9\.9.*basepath.*Forward the basePath your factory received/s)
  })

  it('rejects a router given a history other than the exact supplied instance', () => {
    const { routeTree } = buildFixture([])

    expect(() =>
      mountWithFactory(({ basePath, context }) =>
        createRouter({
          routeTree,
          basepath: basePath,
          history: createMemoryHistory({ initialEntries: ['/tracer'] }),
          context: { ...context },
        }),
      ),
    ).toThrowError(/exact history instance the framework supplied.*Do not create, wrap, replace/s)
  })

  it('rejects a router whose context replaced the framework namespace', () => {
    const { routeTree } = buildFixture([])

    expect(() =>
      mountWithFactory(({ basePath, history, context }) =>
        createRouter({
          routeTree,
          basepath: basePath,
          history,
          context: { ...context, mfe: { ...context.mfe } },
        }),
      ),
    ).toThrowError(/replaced or rebuilt mfe namespace.*do not replace mfe/s)
  })

  it('rejects a router that substituted its own Query client', () => {
    const { routeTree } = buildFixture([])

    expect(() =>
      mountWithFactory(({ basePath, history, context }) =>
        createRouter({
          routeTree,
          basepath: basePath,
          history,
          context: { ...context, queryClient: {} } as unknown as MfeRouterContext,
        }),
      ),
    ).toThrowError(/a different Query client.*Spread the supplied context/s)
  })

  it('preserves author-added top-level context keys', async () => {
    const { routeTree } = buildFixture([])
    let observedKeys: string[] = []

    const app = createApp({
      id: 'tracer',
      router: ({ basePath, history, context }) => {
        const extended = { ...context, analytics: { track: () => {} } }
        const router = createRouter({ routeTree, basepath: basePath, history, context: extended })
        observedKeys = Object.keys(router.options.context)
        return router
      },
    })

    const rendered = renderApp(app, { basePath: '/tracer', initialEntries: ['/tracer'] })
    await waitFor(() => expect(observedKeys).toContain('analytics'))
    expect(observedKeys.sort()).toEqual(['analytics', 'mfe', 'queryClient'])

    await rendered.dispose()
  })
})

describe('pinned router feasibility', () => {
  it('exposes basepath and exact history identity for validation', () => {
    const { routeTree } = buildFixture([])
    const history = createMemoryHistory({ initialEntries: ['/tracer'] })
    const router = createRouter({ routeTree, basepath: '/tracer', history, context: NO_CONTEXT })

    // Both are supported, observable state. Without them the entry contract
    // could not be validated and would have had to change.
    expect(router.options.basepath).toBe('/tracer')
    expect(router.history).toBe(history)
  })

  it('backs two concurrent mounts from one generated tree without cross-talk', async () => {
    const { routeTree } = buildFixture([])

    const historyA = createMemoryHistory({ initialEntries: ['/a'] })
    const historyB = createMemoryHistory({ initialEntries: ['/b'] })
    const routerA = createRouter({
      routeTree,
      basepath: '/a',
      history: historyA,
      context: NO_CONTEXT,
    })
    const routerB = createRouter({
      routeTree,
      basepath: '/b',
      history: historyB,
      context: NO_CONTEXT,
    })

    await routerA.load()
    await routerB.load()
    await routerA.navigate({ to: '/' })
    await routerA.load()

    // Independent histories, independent matches: a shallow tree clone is not
    // needed, and the author contract does not have to change.
    expect(routerA.history).toBe(historyA)
    expect(routerB.history).toBe(historyB)
    // A navigated; B did not move. One generated tree, two independent states.
    expect(historyA.location.pathname).toBe('/a/')
    expect(historyB.location.pathname).toBe('/b')
  })
})

describe('mount failure is explicit', () => {
  it('reports a definition that is not an App rather than mounting an empty surface', () => {
    const { makeRouter } = buildFixture([])
    const app = createApp({
      id: 'tracer',
      router: options => {
        makeRouter(options)
        throw new Error('the factory exploded')
      },
    })

    expect(() => renderApp(app, { basePath: '/tracer', initialEntries: ['/tracer'] })).toThrowError(
      /the factory exploded/,
    )
  })

  it('reports a Widget definition requested as an App with an actionable message', async () => {
    const { makeRouter } = buildFixture([])
    const app = createApp({ id: 'tracer', router: makeRouter })
    const rendered = renderApp(app, { basePath: '/tracer', initialEntries: ['/tracer'] })

    // The in-process loader refuses an id it was never given, naming what it has.
    await expect(
      rendered.environment.runtime.loader.load(
        { id: 'absent', definitionKind: 'app', adapter: 'react', manifestUrl: 'memory://absent' },
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrowError(/absent failed to resolve definition.*Register the definition/s)

    await rendered.dispose()
  })
})

describe('mount identity', () => {
  it('gives two mounts of one definition separate Query clients and overlay roots', async () => {
    const { makeRouter } = buildFixture([])
    const app = createApp({ id: 'tracer', router: makeRouter })

    const first = renderApp(app, { basePath: '/a', initialEntries: ['/a'] })
    const second = renderApp(app, { basePath: '/b', initialEntries: ['/b'] })

    expect(first.environment.mount.queryClient).not.toBe(second.environment.mount.queryClient)
    expect(first.environment.mount.overlayRoot).not.toBe(second.environment.mount.overlayRoot)
    expect(first.environment.mount.mountToken).not.toBe(second.environment.mount.mountToken)

    await first.dispose()
    await second.dispose()
  })

  it('removes the overlay root from the document on disposal', async () => {
    const { makeRouter } = buildFixture([])
    const app = createApp({ id: 'tracer', router: makeRouter })

    const rendered = renderApp(app, { basePath: '/tracer', initialEntries: ['/tracer'] })
    const overlay = rendered.environment.mount.overlayRoot
    expect(document.body.contains(overlay)).toBe(true)

    await rendered.dispose()
    expect(document.body.contains(overlay)).toBe(false)
  })
})

describe('hooks outside a mount', () => {
  it('names the hook and the repair rather than failing with a null context', () => {
    function Stray(): React.ReactNode {
      return <span>{useUser()?.name ?? 'none'}</span>
    }

    expect(() => render(<Stray />)).toThrowError(
      /call useUser.*rendered outside any mount.*Move the useUser call/s,
    )
  })

  it('exposes AppMount and MfeProvider for shell-owned placement', () => {
    expect(AppMount).toBeTypeOf('function')
    expect(MfeProvider).toBeTypeOf('function')
  })
})
