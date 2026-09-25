/**
 * Mounting under StrictMode: React mounts, unmounts and mounts again without re-rendering, and a
 * mount torn down in an effect cleanup does not survive that (§14).
 */

import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget } from './definition.ts'
import { lazyWidget } from './lazy-widget.tsx'
import { MfeProvider } from './runtime-context.tsx'
import { useMfeSignal } from './hooks/services.ts'
import { useMfeMount } from './mount-context.tsx'
import { MountTree } from './mount-tree.tsx'
import { createMfeTestEnvironment, type MfeTestEnvironment } from './testing/index.tsx'
import type { AppRouterOptions, MfeRouterContext } from './router-contract.ts'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = environment
  environment = null
  await current?.dispose()
})

/** Reports the state of everything the mount owns, from inside the mount. */
const reporter = createWidget({
  id: 'reporter-widget',
  version: '1.0.0',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  render: function Reporter(): ReactNode {
    const aborted = useMfeSignal().aborted
    const mount = useMfeMount('the reporter widget')
    const cache = mount.queryClient.getQueryCache()
    cache.build(mount.queryClient, { queryKey: ['probe'], queryFn: () => 'v' })

    return (
      <dl>
        <dt>aborted</dt>
        <dd data-testid="aborted">{String(aborted)}</dd>
        <dt>overlay attached</dt>
        <dd data-testid="overlay">{String(mount.overlayRoot.isConnected)}</dd>
        <dt>query cache usable</dt>
        <dd data-testid="cache">{String(cache.find({ queryKey: ['probe'] }) !== undefined)}</dd>
      </dl>
    )
  },
})

const Reporter = lazyWidget('reporter-widget')

describe('a mount under StrictMode', () => {
  it('is alive after React unmounts and remounts it', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [reporter] })

    render(
      <StrictMode>
        <MfeProvider runtime={environment.runtime}>
          <Reporter />
        </MfeProvider>
      </StrictMode>,
    )

    await screen.findByTestId('aborted')

    // Every one of these is false or missing on the mount React tore down during its double-invoke.
    expect(screen.getByTestId('aborted')).toHaveTextContent('false')
    expect(screen.getByTestId('overlay')).toHaveTextContent('true')
    expect(screen.getByTestId('cache')).toHaveTextContent('true')
  })
})

/** Two pages, so a browser back has somewhere to go. */
function buildApp() {
  const rootRoute = createRootRouteWithContext<MfeRouterContext>()({
    component: () => <Outlet />,
  })

  const routeTree = rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/storage',
      component: () => <p data-testid="page">storage</p>,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/actions',
      component: () => <p data-testid="page">actions</p>,
    }),
  ])

  return createApp({
    id: 'lab',
    version: '1.0.0',
    router: ({ basePath, history, context }: AppRouterOptions) =>
      createRouter({ routeTree, basepath: basePath, history, context: { ...context } }),
  })
}

describe('an App’s history under StrictMode', () => {
  it('still hears the bridge after React unmounts and remounts it', async () => {
    // What this pins is that the App's tree connects its history to the bridge at all; the narrower
    // claim is in `boundary-history.test.ts`, which jsdom cannot reproduce here (§14).
    environment = createMfeTestEnvironment({
      definitionId: 'lab',
      basePath: '/lab',
      initialEntries: ['/lab/storage', '/lab/actions'],
    })
    const { mount, navigation } = environment

    render(
      <StrictMode>
        <MountTree definition={buildApp()} mount={mount} />
      </StrictMode>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('page')).toHaveTextContent('actions')
    })

    await act(async () => {
      navigation.back()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId('page')).toHaveTextContent('storage')
    })
  })
})
