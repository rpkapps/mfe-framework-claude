/**
 * Two React versions on one page, three levels deep: an App on the test's React (19.3) places an
 * App from a container built against React 19.2, and that App places a Widget on 19.3 again. It
 * is what a framework share scope per React version allows: a container on another React brings
 * its own React, React DOM, adapter and router, while the page keeps one core and one runtime.
 *
 * The 19.2 container is a real second bundle, which `__tests__/build-container-b.ts` builds before
 * the tests run whenever its inputs changed, so its React is a different module from the test's,
 * not a mock of one. Every level mounts the next through the shared runtime's `mountDefinition`,
 * into a root of its own, so no React tree ever renders inside the other React's tree.
 */

import { AppHost, createApp, createWidget, type MfeRouterContext } from '@company/mfe-react'
import { renderSuspending } from '@company/mfe-react/testing'
import { createRootRouteWithContext, createRoute, createRouter } from '@tanstack/react-router'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import {
  createElement as h,
  useEffect,
  useState,
  version as testReactVersion,
  type ReactNode,
} from 'react'
import { version as testReactDomVersion } from 'react-dom'
import { beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'

import {
  createPageRuntime,
  expectedScope,
  expectReleased,
  overlayRootCount,
  reactHostPage,
  scopeOf,
  scopeRootCount,
} from './__tests__/harness.ts'
import { counterContract } from './fixtures/counter.ts'

/** The bundle's own exports, typed here because the test imports the built file, not the source. */
interface ContainerB {
  readonly bundledVersions: { readonly react: string; readonly reactDom: string }
  readonly innerLive: { readonly count: number }
  readonly innerApp: ReturnType<typeof createApp>
}

let containerB: ContainerB

beforeAll(async () => {
  containerB = (await import(/* @vite-ignore */ inject('containerB'))) as ContainerB
})

/** How many outer pages and Widgets are mounted right now, reset before every test. */
const live = { outer: 0, widgets: 0 }

beforeEach(() => {
  live.outer = 0
  live.widgets = 0
})

function useCountedWhileMounted(key: keyof typeof live): void {
  useEffect(() => {
    live[key] += 1
    return () => {
      live[key] -= 1
    }
  }, [key])
}

/** The counter's contract, drawn with its React version and a state of its own the test reads. */
const counter = createWidget({
  id: 'counter',
  version: '2.0.0',
  ...counterContract,
  render: function Counter({ inputs, emit }): ReactNode {
    useCountedWhileMounted('widgets')
    const [presses, setPresses] = useState(0)

    return h(
      'div',
      { role: 'group', 'aria-label': 'Counter Widget' },
      h('p', null, `Widget on React ${testReactVersion}`),
      h(
        'button',
        {
          type: 'button',
          onClick: () => {
            setPresses(current => current + 1)
            emit('bumped', { count: inputs.count + 1 })
          },
        },
        `${inputs.label}: ${String(inputs.count)}`,
      ),
      h('p', null, `Widget presses: ${String(presses)}`),
    )
  },
})

function Outer(): ReactNode {
  useCountedWhileMounted('outer')
  const [clicks, setClicks] = useState(0)

  return h(
    'section',
    { 'aria-label': 'Outer App' },
    h('h1', null, `Outer App on React ${testReactVersion}`),
    h(
      'button',
      {
        type: 'button',
        onClick: () => {
          setClicks(current => current + 1)
        },
      },
      `Outer clicks: ${String(clicks)}`,
    ),
    h(AppHost, { appId: 'inner-b', basePath: '/outer/inner' }),
  )
}

const rootRoute = createRootRouteWithContext<MfeRouterContext>()({ component: Outer })
const everyPath = createRoute({ getParentRoute: () => rootRoute, path: '$', component: () => null })

const outerApp = createApp({
  id: 'outer',
  version: '3.0.0',
  router: ({ basePath, history, context }) =>
    createRouter({
      routeTree: rootRoute.addChildren([everyPath]),
      basepath: basePath,
      history,
      context: { ...context },
    }),
})

/**
 * How long a wait on the 19.2 tree may take. That React renders on its own scheduler, outside the
 * `act` the test's React is flushed by, and its first render is the first time the bundle's React,
 * router and adapter run in the worker; with the rest of the suite running beside it, that can
 * take longer than Testing Library's default second. A mount's `whenStable` cannot replace these
 * waits: it covers what a host last handed the mount, and each wait here is on state a tree set
 * for itself, on its router's loads, or on a disposal.
 */
const SECOND_REACT = { timeout: 10_000 }

async function renderThreeLevels() {
  const memory = createPageRuntime({
    definitions: [outerApp, containerB.innerApp, counter],
    initialEntries: ['/outer/inner'],
  })

  const view = await renderSuspending(
    reactHostPage(memory.runtime, h(AppHost, { appId: 'outer', basePath: '/outer' })),
  )
  await screen.findByRole('button', { name: 'Counter: 1' }, SECOND_REACT)

  return {
    memory,
    view,
    outer: screen.getByRole('region', { name: 'Outer App' }),
    inner: screen.getByRole('region', { name: 'Inner App' }),
    widget: screen.getByRole('group', { name: 'Counter Widget' }),
  }
}

describe('two React versions on one page', () => {
  it('builds the container against a React that is not the test’s own', () => {
    expect(testReactVersion).toBe('19.3.0')
    expect(containerB.bundledVersions).toEqual({ react: '19.2.8', reactDom: '19.2.8' })
    expect(testReactDomVersion).toBe(testReactVersion)
  })

  it('renders each level on its own React, one level inside the other', async () => {
    const { outer, inner, widget } = await renderThreeLevels()

    expect(within(outer).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Outer App on React 19.3.0',
    )
    expect(within(inner).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Inner App on React 19.2.8',
    )
    expect(within(widget).getByText('Widget on React 19.3.0')).toBeInTheDocument()
    // The 19.2 App's adapter is its own copy, and it reads the boundary the 19.3 App assigned.
    expect(within(inner).getByText('Inner base path /outer/inner')).toBeInTheDocument()

    expect(scopeOf(outer)).toEqual(expectedScope('outer', 'app'))
    expect(scopeOf(inner)).toEqual(expectedScope('inner-b', 'app'))
    expect(scopeOf(widget)).toEqual(expectedScope('counter', 'widget'))
    expect(outer.contains(inner)).toBe(true)
    expect(inner.contains(widget)).toBe(true)
  })

  it('runs hooks in both Reacts, each keeping its own state', async () => {
    const { outer, inner } = await renderThreeLevels()

    fireEvent.click(within(outer).getByRole('button', { name: 'Outer clicks: 0' }))
    // Each React schedules its own work, and the test's `act` flushes only the test's React, so
    // the 19.2 App's update is awaited rather than read back synchronously.
    fireEvent.click(within(inner).getByRole('button', { name: 'Inner clicks: 0' }))
    fireEvent.click(
      await within(inner).findByRole('button', { name: 'Inner clicks: 1' }, SECOND_REACT),
    )

    await within(outer).findByRole('button', { name: 'Outer clicks: 1' })
    await within(inner).findByRole('button', { name: 'Inner clicks: 2' }, SECOND_REACT)
  })

  it('delivers the 19.3 Widget’s event to the 19.2 App, and the App’s answer back down', async () => {
    const { inner, widget } = await renderThreeLevels()

    fireEvent.click(within(widget).getByRole('button', { name: 'Counter: 1' }))

    await within(inner).findByText('Inner received: bumped to 2', undefined, SECOND_REACT)
    await within(widget).findByRole('button', { name: 'Counter: 2' }, SECOND_REACT)
    expect(within(widget).getByText('Widget presses: 1')).toBeInTheDocument()

    fireEvent.click(within(widget).getByRole('button', { name: 'Counter: 2' }))

    await within(inner).findByText('Inner received: bumped to 3', undefined, SECOND_REACT)
    await within(widget).findByRole('button', { name: 'Counter: 3' }, SECOND_REACT)
  })

  it('leaves nothing of any level behind once the host is disposed', async () => {
    const { memory, view } = await renderThreeLevels()
    expect(live).toEqual({ outer: 1, widgets: 1 })
    expect(containerB.innerLive.count).toBe(1)
    expect(scopeRootCount()).toBe(3)
    expect(overlayRootCount()).toBe(3)

    view.unmount()

    await waitFor(() => {
      expect(scopeRootCount()).toBe(0)
    }, SECOND_REACT)
    await waitFor(() => {
      expect(overlayRootCount()).toBe(0)
    }, SECOND_REACT)
    expect(live).toEqual({ outer: 0, widgets: 0 })
    expect(containerB.innerLive.count).toBe(0)
    expectReleased(memory.runtime)
  })
})
