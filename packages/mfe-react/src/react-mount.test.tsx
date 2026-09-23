/**
 * A React definition mounted by a host on another framework: nothing but an element and a mount
 * context, exactly what an Angular host hands over. The provider's validation has to hold there
 * as it does in a React host, because nothing around the element can do it instead.
 */

import type { MfeError } from '@company/mfe-core'
import {
  createMountContext,
  type MountContextHandle,
  type MountedApp,
  type MountedWidget,
} from '@company/mfe-host'
import { createMemoryHostRuntime, type MemoryHostRuntime } from '@company/mfe-host/testing'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { act, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget } from './definition.ts'
import { useBasePath } from './hooks/services.ts'
import type { MfeRouterContext } from './router-contract.ts'
import { withStyleRoot, type StyleRootProps } from './style-root.ts'

let memory: MemoryHostRuntime | null = null
let contexts: MountContextHandle[] = []
let element: HTMLElement

afterEach(async () => {
  for (const handle of contexts) await handle.dispose()
  contexts = []
  memory?.dispose()
  memory = null
  element.remove()
})

/** What an Angular host builds before it calls `mount`: a runtime, a context and an element. */
function hostFor(
  kind: 'app' | 'widget',
  definitionId: string,
  options: { readonly basePath?: string; readonly initialEntries?: readonly string[] } = {},
): MountContextHandle {
  memory = createMemoryHostRuntime(
    options.initialEntries === undefined ? {} : { initialEntries: options.initialEntries },
  )
  const handle = createMountContext({
    runtime: memory.runtime,
    definitionId,
    kind,
    ...(options.basePath === undefined ? {} : { basePath: options.basePath }),
  })
  contexts.push(handle)
  element = document.createElement('div')
  document.body.append(element)
  return handle
}

/** The emit a render last received, so a test can call it the way the Widget's own code does. */
let latestEmit: ((event: string, payload: unknown) => void) | null = null

const counter = createWidget({
  id: 'counter-widget',
  version: '1.0.0',
  inputs: z.object({ label: z.string() }),
  events: { bumped: z.object({ at: z.string() }) },
  render: function Counter({ inputs, emit }): ReactNode {
    latestEmit = emit as (event: string, payload: unknown) => void
    if (inputs.label === 'boom') throw new Error('the Widget cannot render boom')
    return (
      <button
        type="button"
        onClick={() => {
          emit('bumped', { at: 'now' })
        }}
      >
        {inputs.label}
      </button>
    )
  },
})

async function mountCounter(
  inputs: Readonly<Record<string, unknown>>,
  callbacks: {
    readonly emit?: (event: string, payload: unknown) => void
    readonly onInputRejected?: (error: MfeError) => void
  } = {},
): Promise<MountedWidget> {
  const { context } = hostFor('widget', 'counter-widget')
  let mounted: MountedWidget | undefined
  await act(async () => {
    mounted = await counter.mount({
      element,
      context,
      inputs,
      emit: callbacks.emit ?? (() => undefined),
      ...(callbacks.onInputRejected === undefined
        ? {}
        : { onInputRejected: callbacks.onInputRejected }),
    })
  })
  if (!mounted) throw new Error('the Widget did not mount')
  return mounted
}

describe('a React Widget mounting itself', () => {
  it('renders its inputs into the element it was given', async () => {
    await mountCounter({ label: 'Clicks' })

    expect(within(element).getByRole('button')).toHaveTextContent('Clicks')
  })

  it('renders inside its own scope root, in the host’s element', async () => {
    await mountCounter({ label: 'Clicks' })

    const scopeRoot = element.firstElementChild
    expect(scopeRoot?.getAttribute('data-mfe-scope')).toBe('counter-widget')
    expect(scopeRoot?.getAttribute('data-mfe-kind')).toBe('widget')
  })

  it('re-renders with the inputs an update hands it', async () => {
    const mounted = await mountCounter({ label: 'Clicks' })

    act(() => {
      mounted.update({ label: 'Taps' })
    })

    expect(within(element).getByRole('button')).toHaveTextContent('Taps')
  })

  it('hands a validated event to the host', async () => {
    const emit = vi.fn()
    await mountCounter({ label: 'Clicks' }, { emit })

    act(() => {
      within(element).getByRole('button').click()
    })

    expect(emit.mock.calls).toEqual([['bumped', { at: 'now' }]])
  })

  /** The provider's own stack is where the mistake is, so that is where it throws. */
  it('throws an invalid payload at the call site and never hands it over', async () => {
    const emit = vi.fn()
    await mountCounter({ label: 'Clicks' }, { emit })

    expect(() => latestEmit?.('bumped', { at: 7 })).toThrow(/counter-widget/)
    expect(() => latestEmit?.('reset', {})).toThrow(/does not declare/)
    expect(emit).not.toHaveBeenCalled()
  })

  it('rejects the mount when its first inputs fail its own contract', async () => {
    const { context } = hostFor('widget', 'counter-widget')

    const thrown = await counter
      .mount({ element, context, inputs: { label: 7 }, emit: () => undefined })
      .catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'contract/input-mismatch', id: 'counter-widget' })
    expect((thrown as Error).message).toContain('label')
    expect(element.childElementCount).toBe(0)
  })

  /** Outside `act`, because inside it React rethrows the failure to the test instead. */
  it('rejects the mount when its first render throws, and leaves the element empty', async () => {
    const { context } = hostFor('widget', 'counter-widget')

    const thrown = await counter
      .mount({ element, context, inputs: { label: 'boom' }, emit: () => undefined })
      .catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'mount/failure', id: 'counter-widget' })
    expect((thrown as Error).message).toContain('the Widget cannot render boom')
    expect(element.childElementCount).toBe(0)
    expect(memory?.diagnostics).toEqual([])
  })

  it('keeps its last valid inputs when an update fails, and reports it once', async () => {
    const onInputRejected = vi.fn()
    const mounted = await mountCounter({ label: 'Clicks' }, { onInputRejected })

    act(() => {
      mounted.update({ label: 7 })
    })

    expect(within(element).getByRole('button')).toHaveTextContent('Clicks')
    expect(onInputRejected).toHaveBeenCalledTimes(1)
    expect(onInputRejected.mock.calls[0]?.[0]).toMatchObject({ code: 'contract/input-mismatch' })
    expect(memory?.diagnostics.map(diagnostic => diagnostic.error.code)).toEqual([
      'contract/input-mismatch',
    ])
  })

  /**
   * Nothing is left to reject once the mount has resolved, so the runtime hears of it. Outside
   * `act`, because inside it React rethrows the failure to the test instead of reporting it.
   */
  it('reports a render failure after the first to the runtime', async () => {
    const mounted = await mountCounter({ label: 'Clicks' })

    mounted.update({ label: 'boom' })

    await vi.waitFor(() => {
      expect(memory?.diagnostics).toHaveLength(1)
    })
    expect(memory?.diagnostics[0]?.error).toMatchObject({
      code: 'mount/failure',
      id: 'counter-widget',
    })
    expect((memory?.diagnostics[0]?.error as Error).message).toContain('boom')
  })

  it('empties the element when disposed', async () => {
    const mounted = await mountCounter({ label: 'Clicks' })

    await act(async () => {
      await mounted.dispose()
    })

    expect(element.childElementCount).toBe(0)
    expect(element.isConnected).toBe(true)
  })

  /** A container's build attaches the style root to a copy, and the host mounts that copy. */
  it('renders through the style root its container’s build attached', async () => {
    const received: HTMLElement[] = []
    function StyleRoot({ overlayContainer, children }: StyleRootProps): ReactNode {
      received.push(overlayContainer)
      return <section data-testid="style-root">{children}</section>
    }
    const styled = withStyleRoot(counter, StyleRoot)
    const { context } = hostFor('widget', 'counter-widget')

    await act(async () => {
      await styled.mount({ element, context, inputs: { label: 'Clicks' }, emit: () => undefined })
    })

    expect(within(element).getByTestId('style-root')).toContainElement(
      within(element).getByRole('button'),
    )
    expect(received[0]).toBe(context.overlayRoot)
  })
})

function buildReportsApp() {
  const rootRoute = createRootRouteWithContext<MfeRouterContext>()({
    component: () => <Outlet />,
  })
  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/accounts/$accountId',
    component: function Account() {
      // This tree is not the registered one, so the typed accessor resolves to `any`.
      const { accountId } = accountRoute.useParams() as unknown as { accountId: string }
      return (
        <p data-testid="account">
          Account {accountId} under {useBasePath()}
        </p>
      )
    },
  })

  return createApp({
    id: 'reports',
    version: '2.0.0',
    router: ({ basePath, history, context }) =>
      createRouter({
        routeTree: rootRoute.addChildren([accountRoute]),
        basepath: basePath,
        history,
        context: { ...context },
      }),
  })
}

describe('a React App mounting itself', () => {
  it('renders the route under the boundary the host assigned', async () => {
    const reports = buildReportsApp()
    const { context } = hostFor('app', 'reports', {
      basePath: '/reports',
      initialEntries: ['/reports/accounts/7'],
    })

    await act(async () => {
      await reports.mount({ element, context })
    })

    await vi.waitFor(() => {
      expect(within(element).getByTestId('account')).toHaveTextContent('Account 7 under /reports')
    })
  })

  it('publishes its breadcrumbs under the mount the host created', async () => {
    const reports = buildReportsApp()
    const { context } = hostFor('app', 'reports', {
      basePath: '/reports',
      initialEntries: ['/reports/accounts/7'],
    })

    await act(async () => {
      await reports.mount({ element, context })
    })

    await vi.waitFor(() => {
      expect(context.runtime.breadcrumbs.getSnapshot().length).toBeGreaterThan(0)
    })
  })

  it('empties the element and withdraws its breadcrumbs when disposed', async () => {
    const reports = buildReportsApp()
    const { context } = hostFor('app', 'reports', {
      basePath: '/reports',
      initialEntries: ['/reports/accounts/7'],
    })
    let mounted: MountedApp | undefined
    await act(async () => {
      mounted = await reports.mount({ element, context })
    })
    await vi.waitFor(() => {
      expect(within(element).getByTestId('account')).toBeInTheDocument()
    })

    await act(async () => {
      await mounted?.dispose()
    })

    expect(element.childElementCount).toBe(0)
    expect(context.runtime.breadcrumbs.getSnapshot()).toEqual([])
  })

  it('rejects the mount when its router ignores the boundary it was given', async () => {
    const detached = createApp({
      id: 'reports',
      router: ({ history, context }) =>
        createRouter({
          routeTree: createRootRouteWithContext<MfeRouterContext>()({ component: () => null }),
          history,
          context: { ...context },
        }),
    })
    const { context } = hostFor('app', 'reports', { basePath: '/reports' })

    const thrown = await detached.mount({ element, context }).catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'app/invalid-base-path', id: 'reports' })
    expect(element.childElementCount).toBe(0)
  })
})
