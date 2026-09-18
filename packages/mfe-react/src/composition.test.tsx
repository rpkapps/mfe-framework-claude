/**
 * Composition: a Widget loaded through the loader and consumed as a component,
 * and a child App delegated at a splat route.
 *
 * The tracer bullet proves one App mounts. This proves the two composition
 * models behave differently in the ways that matter: Apps take URLs and get
 * their own boundary, Widgets take props and get no boundary at all.
 */

import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Suspense, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget } from './definition.ts'
import { lazyWidget } from './lazy-widget.tsx'
import { AppHost } from './app-host.tsx'
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
  await environment?.dispose()
  environment = null
})

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

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
      const { accountId } = accountRoute.useParams()
      const basePath = useBasePath()
      const signal = useMfeSignal()

      observed.basePath = basePath
      observed.signalAborted = signal.aborted

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

/* -------------------------------------------------------------------------- */

describe('consuming a Widget', () => {
  it('loads through the loader and renders as an ordinary lazy component', async () => {
    environment = createMfeTestEnvironment({
      definitionId: 'host-app',
      definitions: [counterWidget],
    })

    await renderSuspending(
      <MfeProvider runtime={environment.runtime}>
        <Suspense fallback={<p>Loading…</p>}>
          <CounterWidget label="Clicks" count={3} />
        </Suspense>
      </MfeProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Clicks: 3'))
  })

  it('delivers a validated event to the consumer handler', async () => {
    environment = createMfeTestEnvironment({
      definitionId: 'host-app',
      definitions: [counterWidget],
    })

    const onBumped = vi.fn()

    await renderSuspending(
      <MfeProvider runtime={environment.runtime}>
        <Suspense fallback={null}>
          <CounterWidget label="Clicks" count={7} onBumped={onBumped} />
        </Suspense>
      </MfeProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button'))

    expect(onBumped).toHaveBeenCalledWith({ to: 8 })
  })

  it('renders the fallback with a retry when the Widget cannot be resolved', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host-app', definitions: [] })

    await renderSuspending(
      <MfeProvider runtime={environment.runtime}>
        <Suspense fallback={null}>
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
          />
        </Suspense>
      </MfeProvider>,
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

    await renderSuspending(
      <MfeProvider runtime={environment.runtime}>
        <Suspense fallback={null}>
          <Probe />
        </Suspense>
      </MfeProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())
    expect(observedBasePath).toBe('')
  })
})

describe('nesting a child App', () => {
  it('mounts the child at the boundary the parent assigned', async () => {
    const observed: { basePath?: string; signalAborted?: boolean } = {}
    const childApp = buildChildApp(observed)

    environment = createMfeTestEnvironment({
      definitionId: 'parent-app',
      definitions: [childApp],
      initialEntries: ['/reports/accounts/42'],
    })

    await renderSuspending(
      <MfeProvider runtime={environment.runtime}>
        <Suspense fallback={null}>
          <AppHost appId="child-reports" basePath="/reports" />
        </Suspense>
      </MfeProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('child-account')).toBeInTheDocument())

    // The child read its own URL parameter. It never parsed the mount prefix.
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
      <MfeProvider runtime={first.runtime}>
        <Suspense fallback={null}>
          <AppHost appId="child-reports" basePath="/reports" />
        </Suspense>
      </MfeProvider>,
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
      <MfeProvider runtime={environment.runtime}>
        <Suspense fallback={null}>
          <AppHost appId="child-reports" basePath="/workspace/reports" />
        </Suspense>
      </MfeProvider>,
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
      <MfeProvider runtime={environment.runtime}>
        <Suspense fallback={null}>
          <AppHost
            appId="counter-widget"
            basePath="/reports"
            fallback={({ error }) => <p data-testid="app-error">{error.message}</p>}
          />
        </Suspense>
      </MfeProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('app-error')).toBeInTheDocument())
    expect(screen.getByTestId('app-error')).toHaveTextContent(
      /Widget definition, which owns no URL boundary/,
    )
  })

  it('disposes the child when it is removed, aborting its mount signal', async () => {
    const observed: { basePath?: string; signalAborted?: boolean } = {}
    const childApp = buildChildApp(observed)

    environment = createMfeTestEnvironment({
      definitionId: 'parent-app',
      definitions: [childApp],
      initialEntries: ['/reports/accounts/1'],
    })

    function Parent({ show }: { readonly show: boolean }): ReactNode {
      return (
        <MfeProvider runtime={environment!.runtime}>
          <Suspense fallback={null}>
            {show ? <AppHost appId="child-reports" basePath="/reports" /> : <p>gone</p>}
          </Suspense>
        </MfeProvider>
      )
    }

    const rendered = await renderSuspending(<Parent show />)
    await waitFor(() => expect(screen.getByTestId('child-account')).toBeInTheDocument())

    rendered.rerender(<Parent show={false} />)

    await waitFor(() => expect(screen.getByText('gone')).toBeInTheDocument())
    expect(screen.queryByTestId('child-account')).not.toBeInTheDocument()
  })
})
