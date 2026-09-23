/**
 * A React definition mounting itself: nothing but an element and a mount context, exactly what
 * every host hands over, a React host included. The provider's validation has to hold there,
 * because nothing around the element can do it instead.
 */

import type { MfeError } from '@company/mfe-core'
import {
  createMountContext,
  type MountContextHandle,
  type MountedApp,
  type MountedWidget,
} from '@company/mfe-runtime'
import { createMemoryRuntime, type MemoryRuntime } from '@company/mfe-runtime/testing'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { act, within } from '@testing-library/react'
import { useId, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget } from './definition.ts'
import { useBasePath, useScopeRoot } from './hooks/services.ts'
import type { MfeRouterContext } from './router-contract.ts'
import { withStyleRoot, type StyleRootProps } from './style-root.ts'

/** The runtime the latest `hostFor` made; every one made is disposed after the test. */
let memory: MemoryRuntime | null = null
let memories: MemoryRuntime[] = []
let contexts: MountContextHandle[] = []
let element: HTMLElement

afterEach(async () => {
  for (const handle of contexts) await handle.dispose()
  contexts = []
  for (const made of memories) made.dispose()
  memories = []
  memory = null
  element.remove()
})

function createRuntime(initialEntries?: readonly string[]): MemoryRuntime {
  memory = createMemoryRuntime(initialEntries === undefined ? {} : { initialEntries })
  memories.push(memory)
  return memory
}

/** What every host builds before it calls `mount`: a runtime, a context and an element. */
function hostFor(
  kind: 'app' | 'widget',
  definitionId: string,
  options: { readonly basePath?: string; readonly initialEntries?: readonly string[] } = {},
): MountContextHandle {
  const { runtime } = createRuntime(options.initialEntries)
  const handle = createMountContext({
    runtime,
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

/** What a host without a failure handler of its own passes; `mountDefinition` always supplies one. */
const noopFailure = (): void => undefined

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
      onFailure: noopFailure,
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

  /** The runtime made the scope root around the element; a second one would nest the scope. */
  it('renders straight into the element, adding no scope root of its own', async () => {
    await mountCounter({ label: 'Clicks' })

    expect(element.querySelector('[data-mfe-scope]')).toBeNull()
    expect(element.firstElementChild).toBe(within(element).getByRole('button'))
  })

  it('gives the Widget a Query client of its own mount', async () => {
    const { context } = hostFor('widget', 'client-probe')
    let seen: QueryClient | null = null
    const probe = createWidget({
      id: 'client-probe',
      inputs: z.object({}),
      events: {},
      render: function ClientProbe(): ReactNode {
        seen = useQueryClient()
        return null
      },
    })

    await act(async () => {
      await probe.mount({
        element,
        context,
        inputs: {},
        emit: () => undefined,
        onFailure: noopFailure,
      })
    })

    expect(seen).toBeInstanceOf(QueryClient)
    expect(seen).not.toBeNull()
  })

  /** Every mount is a root of its own, and `useId` counts per root. */
  it('prefixes the ids it hands out with its mount, so two roots never collide', async () => {
    const ids: string[] = []
    const probe = createWidget({
      id: 'id-probe',
      inputs: z.object({}),
      events: {},
      render: function IdProbe(): ReactNode {
        const id = useId()
        ids.push(id)
        return <span id={id} />
      },
    })
    const first = hostFor('widget', 'id-probe').context
    const firstElement = element
    const second = hostFor('widget', 'id-probe').context

    await act(async () => {
      await probe.mount({
        element: firstElement,
        context: first,
        inputs: {},
        emit: () => undefined,
        onFailure: noopFailure,
      })
      await probe.mount({
        element,
        context: second,
        inputs: {},
        emit: () => undefined,
        onFailure: noopFailure,
      })
    })

    expect(new Set(ids).size).toBe(2)
    firstElement.remove()
  })

  it('reads the scope root the runtime made through useScopeRoot', async () => {
    const scopeRoot = document.createElement('div')
    let seen: HTMLElement | null = null
    const probe = createWidget({
      id: 'scope-probe',
      inputs: z.object({}),
      events: {},
      render: function ScopeProbe(): ReactNode {
        seen = useScopeRoot()
        return null
      },
    })
    const handle = createMountContext({
      runtime: createRuntime().runtime,
      definitionId: 'scope-probe',
      kind: 'widget',
      scopeRoot,
    })
    contexts.push(handle)
    element = document.createElement('div')
    scopeRoot.append(element)
    document.body.append(scopeRoot)

    await act(async () => {
      await probe.mount({
        element,
        context: handle.context,
        inputs: {},
        emit: () => undefined,
        onFailure: noopFailure,
      })
    })

    expect(seen).toBe(scopeRoot)
    expect(scopeRoot.getAttribute('data-mfe-scope')).toBe('scope-probe')
    scopeRoot.remove()
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
      .mount({
        element,
        context,
        inputs: { label: 7 },
        emit: () => undefined,
        onFailure: noopFailure,
      })
      .catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'contract/input-mismatch', id: 'counter-widget' })
    expect((thrown as Error).message).toContain('label')
    expect(element.childElementCount).toBe(0)
  })

  /** Outside `act`, because inside it React rethrows the failure to the test instead. */
  it('rejects the mount when its first render throws, and leaves the element empty', async () => {
    const { context } = hostFor('widget', 'counter-widget')

    const thrown = await counter
      .mount({
        element,
        context,
        inputs: { label: 'boom' },
        emit: () => undefined,
        onFailure: noopFailure,
      })
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
   * Nothing is left to reject once the mount has resolved, so the host's `onFailure` hears of it
   * instead — every host provides one. Outside `act`, because inside it React rethrows the
   * failure to the test instead of reporting it.
   */
  it('hands a render failure after the first to the host’s onFailure', async () => {
    const { context } = hostFor('widget', 'counter-widget')
    const onFailure = vi.fn()
    let mounted: MountedWidget | undefined
    await act(async () => {
      mounted = await counter.mount({
        element,
        context,
        inputs: { label: 'Clicks' },
        emit: () => undefined,
        onFailure,
      })
    })

    mounted?.update({ label: 'boom' })

    await vi.waitFor(() => {
      expect(onFailure).toHaveBeenCalledTimes(1)
    })
    expect(onFailure.mock.calls[0]?.[0]).toMatchObject({ code: 'mount/failure' })
    expect(memory?.diagnostics).toEqual([])
  })

  describe('a contract that produces an input name a host reserves', () => {
    /** Optional, so a first set without it mounts and only a later one produces the name. */
    const picker = createWidget({
      id: 'picker',
      version: '2.0.0',
      inputs: z.object({ label: z.string(), onPick: z.string().optional() }),
      events: {},
      render: ({ inputs }): ReactNode => <p>{inputs.label}</p>,
    })

    /** The Angular adapter fails with this same message, word for word. */
    const RESERVED_MESSAGE =
      "picker failed to declare input 'onPick': expected an input name that is not reserved for host control or event handlers, received 'onPick', which is reserved. Rename the input; key, ref, fallback and onX names belong to the host."

    /** Outside `act`, because inside it React rethrows the failure to the test instead. */
    it('rejects the first mount with the declaration error', async () => {
      const { context } = hostFor('widget', 'picker')
      const onInputRejected = vi.fn()

      const thrown = await picker
        .mount({
          element,
          context,
          inputs: { label: 'Pick', onPick: 'x' },
          emit: () => undefined,
          onFailure: noopFailure,
          onInputRejected,
        })
        .catch((error: unknown) => error)

      expect(thrown).toMatchObject({ code: 'contract/input-mismatch', id: 'picker' })
      expect((thrown as Error).message).toBe(RESERVED_MESSAGE)
      expect(onInputRejected).not.toHaveBeenCalled()
      expect(element.childElementCount).toBe(0)
    })

    it('hands a later set that produces the name to onFailure, not onInputRejected', async () => {
      const { context } = hostFor('widget', 'picker')
      const onFailure = vi.fn()
      const onInputRejected = vi.fn()
      let mounted: MountedWidget | undefined
      await act(async () => {
        mounted = await picker.mount({
          element,
          context,
          inputs: { label: 'Pick' },
          emit: () => undefined,
          onFailure,
          onInputRejected,
        })
      })

      mounted?.update({ label: 'Pick', onPick: 'x' })

      await vi.waitFor(() => {
        expect(onFailure).toHaveBeenCalledTimes(1)
      })
      expect(onFailure.mock.calls[0]?.[0]).toMatchObject({
        code: 'contract/input-mismatch',
        message: RESERVED_MESSAGE,
      })
      expect(onInputRejected).not.toHaveBeenCalled()
    })
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
      await styled.mount({
        element,
        context,
        inputs: { label: 'Clicks' },
        emit: () => undefined,
        onFailure: noopFailure,
      })
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
      await reports.mount({ element, context, onFailure: noopFailure })
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
      await reports.mount({ element, context, onFailure: noopFailure })
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
      mounted = await reports.mount({ element, context, onFailure: noopFailure })
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

    const thrown = await detached
      .mount({ element, context, onFailure: noopFailure })
      .catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'app/invalid-base-path', id: 'reports' })
    expect(element.childElementCount).toBe(0)
  })
})
