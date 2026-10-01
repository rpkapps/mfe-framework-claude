import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget } from './definition.ts'
import type { MfeRouterContext } from './router-contract.ts'
import { renderApp, renderWidget } from './testing/index.tsx'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

describe('mount-owned security sessions', () => {
  it('refreshes an active Widget query and rejects late query/mutation writes from the old session', async () => {
    const requests: ReturnType<typeof deferred<string>>[] = []
    const signals: AbortSignal[] = []
    const mutation = deferred<string>()
    let startMutation = () => undefined
    const widget = createWidget({
      id: 'session-widget',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      render: function SessionWidget() {
        const client = useQueryClient()
        const query = useQuery({
          queryKey: ['private'],
          queryFn: ({ signal }) => {
            signals.push(signal)
            const request = deferred<string>()
            requests.push(request)
            return request.promise
          },
        })
        const save = useMutation({
          mutationFn: () => mutation.promise,
          onSuccess: value => {
            client.setQueryData(['private'], value)
          },
        })
        startMutation = () => {
          save.mutate()
        }
        return <p data-testid="private">{query.data ?? 'Loading current session'}</p>
      },
    })
    const rendered = renderWidget(widget, { shellState: { user: { id: 'ada', name: 'Ada' } } })
    const firstClient = rendered.environment.mount.queryClient
    await waitFor(() => expect(requests).toHaveLength(1))
    await act(async () => {
      requests[0]!.resolve('Ada private data')
    })
    await waitFor(() => expect(screen.getByTestId('private')).toHaveTextContent('Ada private data'))
    act(() => {
      startMutation()
    })

    // An uncancellable request to an inactive cache key must be retired too.
    const lateQuery = deferred<string>()
    const oldRequest = firstClient.fetchQuery({
      queryKey: ['background'],
      queryFn: ({ signal }) => {
        signals.push(signal)
        return lateQuery.promise
      },
    })
    void oldRequest.catch(() => undefined)
    rendered.environment.setShellState({ user: { id: 'grace', name: 'Grace' } })
    const nextClient = rendered.environment.mount.queryClient

    expect(nextClient).not.toBe(firstClient)
    expect(firstClient.getQueryCache().getAll()).toHaveLength(0)
    expect(firstClient.getMutationCache().getAll()).toHaveLength(0)
    expect(signals[1]?.aborted).toBe(true)
    expect(screen.getByTestId('private')).toHaveTextContent('Loading current session')
    await waitFor(() => expect(requests).toHaveLength(2))
    await act(async () => {
      mutation.resolve('Late Ada mutation')
      lateQuery.resolve('Late Ada query')
    })
    expect(nextClient.getQueryData(['private'])).toBeUndefined()
    expect(nextClient.getQueryData(['background'])).toBeUndefined()
    expect(screen.getByTestId('private')).not.toHaveTextContent('Ada')
    await act(async () => {
      requests[1]!.resolve('Grace private data')
    })
    await waitFor(() =>
      expect(screen.getByTestId('private')).toHaveTextContent('Grace private data'),
    )
    await rendered.dispose()
  })

  it('replaces App route data and context for permissions, account changes and sign-out', async () => {
    const observed: string[] = []
    const pending = deferred<string>()
    const root = createRootRouteWithContext<MfeRouterContext>()({ component: () => <Outlet /> })
    const index = createRoute({
      getParentRoute: () => root,
      path: '/',
      loader: ({ context }) => {
        const identity = `${context.mfe.user?.id ?? 'signed-out'}:${context.mfe.user?.accountId ?? '-'}:${context.mfe.groups.join(',')}`
        observed.push(identity)
        return identity === 'ada:-:reader' ? pending.promise : Promise.resolve(identity)
      },
      pendingMs: 0,
      component: function PrivateRoute() {
        return <p data-testid="route-data">{index.useLoaderData()}</p>
      },
    })
    const routeTree = root.addChildren([index])
    const app = createApp({
      id: 'session-app',
      router: ({ history, basePath, context }) =>
        createRouter({
          history,
          basepath: basePath,
          context,
          routeTree,
          defaultPendingMinMs: 0,
        }),
    })
    const rendered = renderApp(app, {
      shellState: { user: { id: 'ada', name: 'Ada' }, groups: ['admin'] },
    })
    await waitFor(() => expect(screen.getByTestId('route-data')).toHaveTextContent('ada:-:admin'))

    rendered.environment.setShellState({ groups: ['reader'] })
    await waitFor(() => expect(observed).toContain('ada:-:reader'))
    expect(screen.queryByTestId('route-data')).toBeNull()
    rendered.environment.setShellState({ user: { id: 'ada', name: 'Ada', accountId: 'other' } })
    await waitFor(() =>
      expect(screen.getByTestId('route-data')).toHaveTextContent('ada:other:reader'),
    )
    await act(async () => {
      pending.resolve('obsolete privileged route')
    })
    expect(screen.getByTestId('route-data')).not.toHaveTextContent('obsolete')

    rendered.environment.setShellState({ user: null, groups: [] })
    await waitFor(() => expect(screen.getByTestId('route-data')).toHaveTextContent('signed-out:-:'))
    expect(observed).toEqual(['ada:-:admin', 'ada:-:reader', 'ada:other:reader', 'signed-out:-:'])
    await rendered.dispose()
  })

  it('retains clients and local view state for theme, display-name and group-order changes', async () => {
    const widget = createWidget({
      id: 'stable-session',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      render: function Counter() {
        const [count, setCount] = useState(0)
        return (
          <button
            onClick={() => {
              setCount(value => value + 1)
            }}
          >
            {count}
          </button>
        )
      },
    })
    const rendered = renderWidget(widget, {
      shellState: { user: { id: 'ada', name: 'Ada' }, groups: ['a', 'b'] },
    })
    const { mount } = rendered.environment
    const client = mount.queryClient
    fireEvent.click(screen.getByRole('button'))
    rendered.environment.setShellState({
      theme: 'dark',
      user: { id: 'ada', name: 'Ada Lovelace' },
      groups: ['b', 'a'],
    })
    act(() => {
      rendered.environment.runtime.shellState.apply({}, { tokenRefresh: true })
    })
    expect(mount.queryClient).toBe(client)
    expect(screen.getByRole('button')).toHaveTextContent('1')
    rendered.environment.setShellState({ groups: ['b'] })
    expect(mount.queryClient).not.toBe(client)
    expect(screen.getByRole('button')).toHaveTextContent('0')
    const last = mount.queryClient
    await rendered.dispose()
    rendered.environment.runtime.shellState.apply({ user: null })
    expect(mount.queryClient).toBe(last)
  })
})
