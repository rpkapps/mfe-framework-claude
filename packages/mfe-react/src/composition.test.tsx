/**
 * Composition: a Widget loaded through the loader and consumed as a component, and a child App
 * delegated at a splat route, which is where the two models differ — Apps own a boundary.
 */

import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Suspense, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget } from './definition.ts'
import { renderApp } from './testing/index.tsx'
import { lazyWidget } from './lazy-widget.tsx'
import { AppHost, mfeRoute } from './app-host.tsx'
import { MfeProvider } from './runtime-context.tsx'
import {
  createMfeTestEnvironment,
  renderSuspending,
  type MfeTestEnvironment,
} from './testing/index.tsx'
import { useBasePath, useMfeSignal } from './hooks/services.ts'
import type { AppRouterOptions, MfeRouterContext } from './router-contract.ts'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = environment
  environment = null
  await current?.dispose()
})

const counterWidget = createWidget({
  id: 'counter-widget',
  version: '1.0.0',
  inputs: z.object({ label: z.string(), count: z.number().default(0) }),
  events: { bumped: z.object({ to: z.number() }) },
  render: ({ inputs, emit }) => (
    <button type="button" onClick={() => emit('bumped', { to: inputs.count + 1 })}>
      {inputs.label}: {inputs.count}
    </button>
  ),
})

/** Built at module scope, as the contract requires for a stable identity. */
const CounterWidget = lazyWidget('counter-widget', {
  contract: { inputs: counterWidget.contract.inputs, events: counterWidget.contract.events },
})

function buildChildApp(observed: { basePath?: string; signalAborted?: boolean }) {
  const rootRoute = createRootRouteWithContext<MfeRouterContext>()({
    component: () => <Outlet />,
  })

  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/accounts/$accountId',
    component: function Account() {
      // This tree is not the registered one, so the typed accessor resolves to `any`.
      const { accountId } = accountRoute.useParams() as unknown as { accountId: string }

      observed.basePath = useBasePath()
      observed.signalAborted = useMfeSignal().aborted

      return <p data-testid="child-account">Account {accountId}</p>
    },
  })

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <p data-testid="child-index">Child index</p>,
  })

  const routeTree = rootRoute.addChildren([indexRoute, accountRoute])

  return createApp({
    id: 'child-reports',
    version: '1.0.0',
    router: ({ basePath, history, context }: AppRouterOptions) =>
      createRouter({ routeTree, basepath: basePath, history, context: { ...context } }),
  })
}

/** Every case renders through the shell provider with a Suspense boundary. */
function hosted(runtime: MfeTestEnvironment['runtime'], children: ReactNode): ReactNode {
  return (
    <MfeProvider runtime={runtime}>
      <Suspense fallback={null}>{children}</Suspense>
    </MfeProvider>
  )
}

describe('consuming a Widget', () => {
  it('loads through the loader and renders as an ordinary lazy component', async () => {
    environment = createMfeTestEnvironment({
      definitionId: 'host-app',
      definitions: [counterWidget],
    })

    await renderSuspending(hosted(environment.runtime, <CounterWidget label="Clicks" count={3} />))

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Clicks: 3'))
  })

  it('delivers a validated event to the consumer handler', async () => {
    environment = createMfeTestEnvironment({
      definitionId: 'host-app',
      definitions: [counterWidget],
    })

    const onBumped = vi.fn()

    await renderSuspending(
      hosted(environment.runtime, <CounterWidget label="Clicks" count={7} onBumped={onBumped} />),
    )

    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button'))

    expect(onBumped).toHaveBeenCalledWith({ to: 8 })
  })

  it('renders the fallback with a retry when the Widget cannot be resolved', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host-app', definitions: [] })

    await renderSuspending(
      hosted(
        environment.runtime,
        <CounterWidget
          label="Clicks"
          count={0}
          fallback={({ error, retry }) => (
            <div>
              <p data-testid="widget-error">{error.message}</p>
              <button type="button" onClick={retry}>
                Retry
              </button>
            </div>
          )}
        />,
      ),
    )

    await waitFor(() => expect(screen.getByTestId('widget-error')).toBeInTheDocument())

    // The failure is explicit and names the repair rather than rendering empty.
    expect(screen.getByTestId('widget-error')).toHaveTextContent(/counter-widget/)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('gives the Widget no URL boundary', async () => {
    let observedBasePath: string | null = null

    const boundaryProbe = createWidget({
      id: 'boundary-probe',
      inputs: z.object({}),
      events: {},
      render: function Probe() {
        observedBasePath = useBasePath()
        return <span data-testid="probe">ready</span>
      },
    })

    environment = createMfeTestEnvironment({
      definitionId: 'host-app',
      definitions: [boundaryProbe],
    })

    const Probe = lazyWidget('boundary-probe')

    await renderSuspending(hosted(environment.runtime, <Probe />))

    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())
    expect(observedBasePath).toBe('')
  })
})

/** Delegating through `mfeRoute` is the only path that exercises how the boundary is computed. */
function buildParentApp() {
  const rootRoute = createRootRouteWithContext<MfeRouterContext>()({
    component: () => <Outlet />,
  })

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <p data-testid="parent-index">Parent index</p>,
  })

  const delegated = createRoute({
    getParentRoute: () => rootRoute,
    path: '/reports/$',
    ...mfeRoute({ appId: 'child-reports' }),
  })

  const routeTree = rootRoute.addChildren([indexRoute, delegated])

  return createApp({
    id: 'parent-app',
    version: '1.0.0',
    router: ({ basePath, history, context }: AppRouterOptions) =>
      createRouter({ routeTree, basepath: basePath, history, context: { ...context } }),
  })
}

describe('delegating to a child App at a splat route', () => {
  /** The boundary used to be the whole current pathname, so a child had nothing left to route. */
  it('gives the child everything below the splat, not the whole path', async () => {
    const observed: { basePath?: string } = {}

    const rendered = renderApp(buildParentApp(), {
      definitions: [buildChildApp(observed)],
      initialEntries: ['/reports/accounts/42'],
    })
    environment = rendered.environment

    await waitFor(() => expect(screen.getByTestId('child-account')).toBeInTheDocument())

    expect(screen.getByTestId('child-account')).toHaveTextContent('Account 42')
    expect(observed.basePath).toBe('/reports')
    expect(screen.queryByTestId('child-index')).not.toBeInTheDocument()
  })

  it('mounts the child index when the splat is empty', async () => {
    const rendered = renderApp(buildParentApp(), {
      definitions: [buildChildApp({})],
      initialEntries: ['/reports'],
    })
    environment = rendered.environment

    // The boundary consumed the whole path, so the child routes its own index.
    await waitFor(() => expect(screen.getByTestId('child-index')).toBeInTheDocument())
    expect(screen.queryByTestId('child-account')).not.toBeInTheDocument()
  })

  it('keeps the child contract identical under a deeper parent boundary', async () => {
    const observed: { basePath?: string } = {}

    const rendered = renderApp(buildParentApp(), {
      definitions: [buildChildApp(observed)],
      basePath: '/workspace',
      initialEntries: ['/reports/accounts/42'],
    })
    environment = rendered.environment

    await waitFor(() => expect(screen.getByTestId('child-account')).toHaveTextContent('Account 42'))
    expect(observed.basePath).toBe('/workspace/reports')
  })
})

describe('nesting a child App', () => {
  it('mounts the child at the boundary the parent assigned', async () => {
    const observed: { basePath?: string; signalAborted?: boolean } = {}

    environment = createMfeTestEnvironment({
      definitionId: 'parent-app',
      definitions: [buildChildApp(observed)],
      initialEntries: ['/reports/accounts/42'],
    })

    await renderSuspending(
      hosted(environment.runtime, <AppHost appId="child-reports" basePath="/reports" />),
    )

    await waitFor(() => expect(screen.getByTestId('child-account')).toBeInTheDocument())

    // The child read its own URL parameter, never the mount prefix.
    expect(screen.getByTestId('child-account')).toHaveTextContent('Account 42')
    expect(observed.basePath).toBe('/reports')
  })

  it('uses the same contract whether the boundary is shallow or deep', async () => {
    const shallow: { basePath?: string } = {}
    const deep: { basePath?: string } = {}

    const first = createMfeTestEnvironment({
      definitionId: 'parent-app',
      definitions: [buildChildApp(shallow)],
      initialEntries: ['/reports/accounts/7'],
    })

    const firstRender = await renderSuspending(
      hosted(first.runtime, <AppHost appId="child-reports" basePath="/reports" />),
    )
    await waitFor(() => expect(screen.getByTestId('child-account')).toHaveTextContent('Account 7'))
    firstRender.unmount()
    await first.dispose()

    environment = createMfeTestEnvironment({
      definitionId: 'parent-app',
      definitions: [buildChildApp(deep)],
      initialEntries: ['/workspace/reports/accounts/7'],
    })

    await renderSuspending(
      hosted(environment.runtime, <AppHost appId="child-reports" basePath="/workspace/reports" />),
    )
    await waitFor(() => expect(screen.getByTestId('child-account')).toHaveTextContent('Account 7'))

    // Same child, same route, two different boundaries, no contract change.
    expect(shallow.basePath).toBe('/reports')
    expect(deep.basePath).toBe('/workspace/reports')
  })

  it('reports an explicit error when the requested id is a Widget, not an App', async () => {
    environment = createMfeTestEnvironment({
      definitionId: 'parent-app',
      definitions: [counterWidget],
    })

    await renderSuspending(
      hosted(
        environment.runtime,
        <AppHost
          appId="counter-widget"
          basePath="/reports"
          fallback={({ error }) => <p data-testid="app-error">{error.message}</p>}
        />,
      ),
    )

    await waitFor(() => expect(screen.getByTestId('app-error')).toBeInTheDocument())
    expect(screen.getByTestId('app-error')).toHaveTextContent(
      /Widget definition, which owns no URL boundary/,
    )
  })

  it('disposes the child when it is removed, aborting its mount signal', async () => {
    const observed: { basePath?: string; signalAborted?: boolean } = {}

    environment = createMfeTestEnvironment({
      definitionId: 'parent-app',
      definitions: [buildChildApp(observed)],
      initialEntries: ['/reports/accounts/1'],
    })

    function Parent({ show }: { readonly show: boolean }): ReactNode {
      return hosted(
        environment!.runtime,
        show ? <AppHost appId="child-reports" basePath="/reports" /> : <p>gone</p>,
      )
    }

    const rendered = await renderSuspending(<Parent show />)
    await waitFor(() => expect(screen.getByTestId('child-account')).toBeInTheDocument())

    rendered.rerender(<Parent show={false} />)

    await waitFor(() => expect(screen.getByText('gone')).toBeInTheDocument())
    expect(screen.queryByTestId('child-account')).not.toBeInTheDocument()
  })
})
