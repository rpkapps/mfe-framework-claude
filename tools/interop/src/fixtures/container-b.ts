/**
 * A container built against another React: `__tests__/build-container-b.ts` bundles this module
 * with `react` and `react-dom` aliased to the 19.2 copies in `tools/interop-react-b`, the way a
 * federated container on React 19.2 brings its own React scope. Everything React-bound it imports — the adapter,
 * TanStack Router — is bundled with it and binds to that React. `@company/mfe-core` and
 * `@company/mfe-runtime` stay external, because the page shares one copy of each whatever React a
 * container renders with.
 *
 * Nothing here is imported directly by a test: the test imports the bundle.
 */

import { createApp, DynamicWidget, useBasePath, type MfeRouterContext } from '@company/mfe-react'
import { createRootRouteWithContext, createRoute, createRouter } from '@tanstack/react-router'
import { createElement as h, useEffect, useState, version, type ReactNode } from 'react'
import { version as domVersion } from 'react-dom'

/** What the bundle's own React and React DOM report, for the test to compare with its own. */
export const bundledVersions = { react: version, reactDom: domVersion }

/** How many of this App's pages are mounted right now, read by the test's teardown check. */
export const innerLive = { count: 0 }

/**
 * Places the `counter` Widget, which is built on the test's own React, and hands the Widget's
 * count back to it, so an event crosses up from one React to the other and the answer back down.
 */
function Inner(): ReactNode {
  const [clicks, setClicks] = useState(0)
  const [count, setCount] = useState(1)
  const [lastEvent, setLastEvent] = useState('no event yet')

  useEffect(() => {
    innerLive.count += 1
    return () => {
      innerLive.count -= 1
    }
  }, [])

  return h(
    'section',
    { 'aria-label': 'Inner App' },
    h('h2', null, `Inner App on React ${version}`),
    h('p', null, `Inner base path ${useBasePath()}`),
    h(
      'button',
      {
        type: 'button',
        onClick: () => {
          setClicks(current => current + 1)
        },
      },
      `Inner clicks: ${String(clicks)}`,
    ),
    h(DynamicWidget, {
      widgetId: 'counter',
      label: 'Counter',
      count,
      onEvent: (name, payload) => {
        const next = (payload as { readonly count: number }).count
        setLastEvent(`${name} to ${String(next)}`)
        setCount(next)
      },
    }),
    h('p', null, `Inner received: ${lastEvent}`),
  )
}

const rootRoute = createRootRouteWithContext<MfeRouterContext>()({ component: Inner })

// The App owns every path below its boundary, so nothing it is asked for renders as not found.
const everyPath = createRoute({ getParentRoute: () => rootRoute, path: '$', component: () => null })

export const innerApp = createApp({
  id: 'inner-b',
  version: '1.0.0',
  router: ({ basePath, history, context }) =>
    createRouter({
      routeTree: rootRoute.addChildren([everyPath]),
      basepath: basePath,
      history,
      context: { ...context },
    }),
})
