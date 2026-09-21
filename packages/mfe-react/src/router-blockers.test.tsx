/**
 * `useBlocker` inside an App, for navigations the App does not own: the fixtures import no
 * framework navigation API at all, only `useBlocker` (§20).
 */

import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  useBlocker,
  useRouter,
} from '@tanstack/react-router'
import { act, screen, waitFor } from '@testing-library/react'
import { createNavigationIntent, parseBoundaryLocation } from '@company/mfe-host'
import { useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { createApp } from './definition.ts'
import { renderApp, type RenderedMfe } from './testing/index.tsx'
import type { AppRouterOptions, MfeRouterContext } from './router-contract.ts'

let rendered: RenderedMfe | null = null

afterEach(async () => {
  const current = rendered
  rendered = null
  await current?.dispose()
})

/** The navigation the shell would perform: out of this App altogether. */
function leaving(): ReturnType<typeof createNavigationIntent> {
  return createNavigationIntent(
    parseBoundaryLocation('/lab/unsaved'),
    parseBoundaryLocation('/operations'),
    '/lab',
    'PUSH',
  )
}

interface EditorProps {
  /** Left undefined to exercise TanStack's own default. */
  readonly enableBeforeUnload?: boolean | (() => boolean)
}

/** `shouldBlockFn` is an inline arrow, the shape that re-registers on every render (§20). */
function Editor({ enableBeforeUnload }: EditorProps): ReactNode {
  const [isDirty, setIsDirty] = useState(false)
  const router = useRouter()

  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    ...(enableBeforeUnload === undefined ? {} : { enableBeforeUnload }),
    withResolver: true,
  })

  return (
    <div>
      <p data-testid="status">{blocker.status}</p>
      <p data-testid="next">{blocker.status === 'blocked' ? blocker.next.pathname : 'none'}</p>
      <p data-testid="action">{blocker.status === 'blocked' ? blocker.action : 'none'}</p>
      <p data-testid="where">{router.state.location.pathname}</p>

      <button
        type="button"
        onClick={() => {
          setIsDirty(true)
        }}
      >
        type something
      </button>
      <button
        type="button"
        onClick={() => {
          void router.navigate({ to: '/settings' })
        }}
      >
        go to settings
      </button>
      <button
        type="button"
        onClick={() => {
          blocker.proceed?.()
        }}
      >
        discard and leave
      </button>
      <button
        type="button"
        onClick={() => {
          blocker.reset?.()
        }}
      >
        keep editing
      </button>
    </div>
  )
}

/** A mount that can drop its editor, for the disposal case. */
function EditorHost(props: EditorProps): ReactNode {
  const [isMounted, setIsMounted] = useState(true)

  return (
    <div>
      {isMounted ? <Editor {...props} /> : <p data-testid="status">gone</p>}
      <button
        type="button"
        onClick={() => {
          setIsMounted(false)
        }}
      >
        close the editor
      </button>
    </div>
  )
}

function buildApp(props: EditorProps = {}) {
  const rootRoute = createRootRouteWithContext<MfeRouterContext>()({
    component: () => <Outlet />,
  })

  const routeTree = rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/unsaved',
      component: () => <EditorHost {...props} />,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/settings',
      component: () => <p data-testid="status">settings</p>,
    }),
  ])

  return createApp({
    id: 'lab',
    version: '1.0.0',
    router: ({ basePath, history, context }: AppRouterOptions) =>
      createRouter({ routeTree, basepath: basePath, history, context: { ...context } }),
  })
}

async function mountEditor(props: EditorProps = {}): Promise<RenderedMfe> {
  const result = renderApp(buildApp(props), {
    basePath: '/lab',
    initialEntries: ['/lab/unsaved'],
  })

  await waitFor(() => {
    expect(screen.getByTestId('status')).toHaveTextContent('idle')
  })

  return result
}

/** Everything below starts from a form with edits in it. */
async function dirty(props: EditorProps = {}): Promise<RenderedMfe> {
  const result = await mountEditor(props)
  await act(async () => {
    screen.getByRole('button', { name: 'type something' }).click()
    await Promise.resolve()
  })
  return result
}

describe('an App’s own useBlocker covers the shell’s navigations', () => {
  it('lets one through when the App has nothing to lose', async () => {
    rendered = await mountEditor()
    let committed = false

    const outcome = await act(
      async () =>
        await rendered?.environment.runtime.navigator.requestNavigation(leaving(), () => {
          committed = true
        }),
    )

    expect(outcome).toBe('proceeded')
    expect(committed).toBe(true)
    expect(screen.getByTestId('status')).toHaveTextContent('idle')
  })

  it('holds the navigation until the App answers, and commits when it proceeds', async () => {
    rendered = await dirty()
    let committed = false

    const negotiation = rendered.environment.runtime.navigator.requestNavigation(leaving(), () => {
      committed = true
    })

    // The App is being asked in its own terms, resolved against its own route tree.
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('blocked')
    })
    expect(screen.getByTestId('next')).toHaveTextContent('/operations')
    expect(screen.getByTestId('action')).toHaveTextContent('PUSH')
    expect(committed).toBe(false)

    await act(async () => {
      screen.getByRole('button', { name: 'discard and leave' }).click()
      await negotiation
    })

    expect(await negotiation).toBe('proceeded')
    expect(committed).toBe(true)
  })

  it('abandons the navigation when the App refuses', async () => {
    rendered = await dirty()
    let committed = false

    const negotiation = rendered.environment.runtime.navigator.requestNavigation(leaving(), () => {
      committed = true
    })

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('blocked')
    })

    await act(async () => {
      screen.getByRole('button', { name: 'keep editing' }).click()
      await negotiation
    })

    expect(await negotiation).toBe('blocked')
    expect(committed).toBe(false)
  })

  it('still blocks the App’s own routes, which is what the history is asked', async () => {
    // One hook, both kinds of navigation: a history without a blocker store honours none (§1).
    rendered = await dirty()

    await act(async () => {
      screen.getByRole('button', { name: 'go to settings' }).click()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('blocked')
    })
    // Boundary-relative, because the router strips its own basepath.
    expect(screen.getByTestId('where')).toHaveTextContent('/unsaved')

    await act(async () => {
      screen.getByRole('button', { name: 'discard and leave' }).click()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('settings')
    })
  })

  it('does not strand the host when the mount is disposed mid-negotiation', async () => {
    rendered = await dirty()
    const { environment } = rendered
    let committed = false

    const negotiation = environment.runtime.navigator.requestNavigation(leaving(), () => {
      committed = true
    })

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('blocked')
    })

    // Without the mount's signal settling the promise, the host would negotiate forever.
    const disposing = rendered
    rendered = null
    await act(async () => {
      await disposing.dispose()
      await negotiation
    })

    expect(await negotiation).toBe('proceeded')
    expect(committed).toBe(true)
    expect(environment.runtime.navigator.isNegotiating).toBe(false)
  })
})

describe('the browser’s unload prompt', () => {
  it('is not offered by an App that has registered nothing', async () => {
    const app = createApp({
      id: 'quiet',
      version: '1.0.0',
      router: ({ basePath, history, context }: AppRouterOptions) =>
        createRouter({
          routeTree: createRootRouteWithContext<MfeRouterContext>()({
            component: () => <p data-testid="status">idle</p>,
          }),
          basepath: basePath,
          history,
          context: { ...context },
        }),
    })

    rendered = renderApp(app, { basePath: '/quiet', initialEntries: ['/quiet'] })
    await waitFor(() => {
      expect(screen.getByTestId('status')).toBeInTheDocument()
    })

    expect(rendered.environment.runtime.navigator.wantsUnloadPrompt()).toBe(false)
  })

  it('is offered while a blocker is registered, as TanStack defaults it', async () => {
    rendered = await mountEditor()

    expect(rendered.environment.runtime.navigator.wantsUnloadPrompt()).toBe(true)
  })

  it('is refused when the App says enableBeforeUnload is false', async () => {
    rendered = await mountEditor({ enableBeforeUnload: false })

    expect(rendered.environment.runtime.navigator.wantsUnloadPrompt()).toBe(false)
  })

  it('is asked per reload when the App made it a condition', async () => {
    // The shape an author writes, so a clean form does not raise "leave site?" on a refresh.
    let isDirty = false
    rendered = await mountEditor({ enableBeforeUnload: () => isDirty })

    expect(rendered.environment.runtime.navigator.wantsUnloadPrompt()).toBe(false)
    isDirty = true
    expect(rendered.environment.runtime.navigator.wantsUnloadPrompt()).toBe(true)
  })
})
