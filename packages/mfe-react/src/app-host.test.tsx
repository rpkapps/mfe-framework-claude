/**
 * `AppHost` places any App through the runtime's `mountDefinition`: the App mounts itself into an
 * element the host renders, so nothing here depends on which framework built it. The React App at
 * the end is placed the same way, which is what lets two React versions share a page.
 */

import { SCOPE_ATTRIBUTE, KIND_ATTRIBUTE, MOUNT_ATTRIBUTE } from '@company/mfe-runtime'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRoute,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Component, StrictMode, useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { domApp } from './__tests__/dom-definitions.ts'
import { AppHost, mfeRoute } from './app-host.tsx'
import { createBoundaryHistory } from './boundary-history.ts'
import { createApp } from './definition.ts'
import type { AppRouterOptions, MfeRouterContext } from './router-contract.ts'
import { MfeProvider } from './runtime-context.tsx'
import { createMfeTestEnvironment, type MfeTestEnvironment } from './testing/index.tsx'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = environment
  environment = null
  await current?.dispose()
})

function hosted(runtime: MfeTestEnvironment['runtime'], children: ReactNode): ReactNode {
  return <MfeProvider runtime={runtime}>{children}</MfeProvider>
}

function retryable({ error, retry }: { error: Error; retry: () => void }): ReactNode {
  return (
    <div>
      <p data-testid="error">{error.message}</p>
      <button type="button" onClick={retry}>
        Retry
      </button>
    </div>
  )
}

/** Names what reached it, so a test can tell the boundary caught the failure. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override render(): ReactNode {
    const { error } = this.state
    return error === null ? this.props.children : <p data-testid="caught">{error.message}</p>
  }
}

describe('AppHost', () => {
  it('mounts the App inside a scope root the runtime made, at the boundary it was given', async () => {
    const app = domApp()
    environment = createMfeTestEnvironment({ definitionId: 'shell', definitions: [app.definition] })

    render(hosted(environment.runtime, <AppHost appId="reports" basePath="/reports" />))

    expect(await screen.findByTestId('dom-app')).toHaveTextContent('Reports at /reports')
    const target = app.targets[0]
    const scopeRoot = target?.element.closest(`[${SCOPE_ATTRIBUTE}]`)
    expect(scopeRoot?.getAttribute(SCOPE_ATTRIBUTE)).toBe('reports')
    expect(scopeRoot?.getAttribute(MOUNT_ATTRIBUTE)).toBe(target?.context.mountToken)
    expect(scopeRoot?.getAttribute(KIND_ATTRIBUTE)).toBe('app')
    expect(target?.context.scopeRoot).toBe(scopeRoot)
    expect(target?.context).toMatchObject({ kind: 'app', basePath: '/reports', depth: 1 })
    expect(target?.context.runtime.navigator).toBe(environment.runtime.navigator)
  })

  it('shows what it was given while the App is pending, and nothing of it afterwards', async () => {
    const app = domApp()
    environment = createMfeTestEnvironment({ definitionId: 'shell', definitions: [app.definition] })

    render(
      hosted(
        environment.runtime,
        <AppHost appId="reports" basePath="/reports" pending={<p>Loading reports</p>} />,
      ),
    )

    expect(screen.getByText('Loading reports')).toBeInTheDocument()
    await screen.findByTestId('dom-app')
    expect(screen.queryByText('Loading reports')).not.toBeInTheDocument()
  })

  it('is one level deeper than the mount it renders inside, and goes when that mount goes', async () => {
    const app = domApp()
    const workbench = createMfeTestEnvironment({
      definitionId: 'workbench',
      definitions: [app.definition],
    })
    environment = workbench
    const parentSignal = workbench.mount.signal

    render(
      <workbench.wrapper>
        <AppHost appId="reports" basePath="/workbench/reports" />
      </workbench.wrapper>,
    )
    await screen.findByTestId('dom-app')
    expect(app.targets[0]?.context.depth).toBe(2)

    // Disposed here rather than after the test, so nothing else disposes it twice.
    environment = null
    await workbench.dispose()

    expect(parentSignal.aborted).toBe(true)
    await waitFor(() => {
      expect(app.disposals).toBe(1)
    })
  })

  it('disposes the mount when the App leaves the page', async () => {
    const app = domApp()
    environment = createMfeTestEnvironment({ definitionId: 'shell', definitions: [app.definition] })

    const rendered = render(hosted(environment.runtime, <AppHost appId="reports" basePath="/r" />))
    await screen.findByTestId('dom-app')

    rendered.unmount()

    await waitFor(() => {
      expect(app.disposals).toBe(1)
    })
    expect(app.targets[0]?.context.signal.aborted).toBe(true)
  })

  /** StrictMode disposes the first mount before its load settles,, so `mount` runs once. */
  it('mounts the App exactly once under StrictMode', async () => {
    const app = domApp()
    environment = createMfeTestEnvironment({ definitionId: 'shell', definitions: [app.definition] })

    render(
      <StrictMode>
        {hosted(environment.runtime, <AppHost appId="reports" basePath="/reports" />)}
      </StrictMode>,
    )

    await screen.findByTestId('dom-app')
    expect(app.targets).toHaveLength(1)
    expect(app.disposals).toBe(0)
  })

  it('shows a rejected mount in the fallback, and mounts again on retry', async () => {
    const app = domApp()
    app.failNextMount(new Error('NG04002: Cannot match any routes'))
    environment = createMfeTestEnvironment({ definitionId: 'shell', definitions: [app.definition] })

    render(
      hosted(
        environment.runtime,
        <AppHost appId="reports" basePath="/reports" fallback={retryable} />,
      ),
    )

    expect(await screen.findByTestId('error')).toHaveTextContent('NG04002')

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByTestId('dom-app')
    expect(app.targets).toHaveLength(2)
    expect(screen.queryByTestId('error')).not.toBeInTheDocument()
  })

  it('shows a failure the App reports after it mounted, with a retry', async () => {
    const app = domApp()
    environment = createMfeTestEnvironment({ definitionId: 'shell', definitions: [app.definition] })

    render(
      hosted(
        environment.runtime,
        <AppHost appId="reports" basePath="/reports" fallback={retryable} />,
      ),
    )
    await screen.findByTestId('dom-app')

    app.failAfterMount(new Error('the root unmounted itself'))

    expect(await screen.findByTestId('error')).toHaveTextContent('the root unmounted itself')
    expect(screen.queryByTestId('dom-app')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('dom-app')
    expect(app.targets).toHaveLength(2)
  })

  it('throws the failure to the nearest error boundary when it has no fallback', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell', definitions: [] })
    // React reports a caught render error to the console as well.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      hosted(
        environment.runtime,
        <Boundary>
          <AppHost appId="not-registered" basePath="/elsewhere" />
        </Boundary>,
      ),
    )

    expect(await screen.findByTestId('caught')).toHaveTextContent('not-registered')
  })

  it('replaces the mount when it is handed another App', async () => {
    const reports = domApp('reports')
    const billing = domApp('billing')
    environment = createMfeTestEnvironment({
      definitionId: 'shell',
      definitions: [reports.definition, billing.definition],
    })

    function Switcher(): ReactNode {
      const [appId, setAppId] = useState('reports')
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setAppId('billing')
            }}
          >
            switch
          </button>
          <AppHost appId={appId} basePath={`/${appId}`} />
        </>
      )
    }

    render(hosted(environment.runtime, <Switcher />))
    await screen.findByTestId('dom-app')

    await userEvent.click(screen.getByRole('button', { name: 'switch' }))

    await waitFor(() => {
      expect(billing.targets).toHaveLength(1)
    })
    await waitFor(() => {
      expect(reports.disposals).toBe(1)
    })
    expect(screen.getAllByTestId('dom-app')).toHaveLength(1)
  })
})

/** A React App is placed the same way: in a root of its own, inside the runtime's scope root. */
describe('AppHost placing a React App', () => {
  const rootRoute = createRootRouteWithContext<MfeRouterContext>()({ component: () => <Outlet /> })
  const routeTree = rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <p data-testid="react-page">Ledger</p>,
    }),
  ])
  const ledger = createApp({
    id: 'ledger',
    router: ({ basePath, history, context }: AppRouterOptions) =>
      createRouter({ routeTree, basepath: basePath, history, context: { ...context } }),
  })

  it('renders it under exactly one scope root', async () => {
    environment = createMfeTestEnvironment({
      definitionId: 'shell',
      definitions: [ledger],
      initialEntries: ['/ledger'],
    })

    render(hosted(environment.runtime, <AppHost appId="ledger" basePath="/ledger" />))

    const page = await screen.findByTestId('react-page')
    const scopes = [...document.querySelectorAll(`[${SCOPE_ATTRIBUTE}]`)].filter(scope =>
      scope.contains(page),
    )
    expect(scopes).toHaveLength(1)
    expect(scopes[0]?.getAttribute(SCOPE_ATTRIBUTE)).toBe('ledger')
  })
})

/**
 * A host router that moves the page without going through the navigator, as a shell's router
 * does: it pushes to the bridge directly, which no mounted App hears of on its own.
 */
describe('mfeRoute', () => {
  function hostRouter(host: MfeTestEnvironment) {
    const root = createRootRouteWithContext()({ component: () => <Outlet /> })
    const routes: AnyRoute[] = [
      createRoute({ getParentRoute: () => root, path: '/', component: () => null }),
      createRoute({
        getParentRoute: () => root,
        path: '/reports/$',
        ...mfeRoute({ appId: 'reports' }),
      }),
    ]
    return createRouter({
      routeTree: root.addChildren(routes),
      history: createBoundaryHistory(host.navigation).history,
    })
  }

  it('tells mounted Apps where the host router took the page', async () => {
    const app = domApp()
    environment = createMfeTestEnvironment({
      definitionId: 'shell',
      definitions: [app.definition],
      initialEntries: ['/reports/a'],
    })
    const router = hostRouter(environment)
    const heard: string[] = []

    render(hosted(environment.runtime, <RouterProvider router={router} />))
    await screen.findByTestId('dom-app')
    const unsubscribe = environment.runtime.navigator.subscribe(location => {
      heard.push(location.pathname)
    })

    await act(async () => {
      await router.navigate({ to: '/reports/$', params: { _splat: 'b' } })
    })

    await waitFor(() => {
      expect(heard).toEqual(['/reports/b'])
    })
    // Same boundary, so the App moved rather than mounting again.
    expect(app.targets).toHaveLength(1)
    expect(app.targets[0]?.context.basePath).toBe('/reports')
    unsubscribe()
  })
})
