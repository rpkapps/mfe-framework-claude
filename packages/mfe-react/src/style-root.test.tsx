/**
 * The style root is generated plumbing, so what is asserted here is the contract the generated
 * container entry relies on (§17).
 */

import { isMountableDefinition, SCOPE_ATTRIBUTE } from '@company/mfe-runtime'
import { createRootRoute, createRouter } from '@tanstack/react-router'
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ReactNode } from 'react'

import { createApp, createWidget } from './definition.ts'
import { renderApp, renderWidget, type RenderedMfe } from './testing/index.tsx'
import { withStyleRoot, type StyleRootProps } from './style-root.ts'
import type { AppRouterOptions } from './router-contract.ts'

let rendered: RenderedMfe | null = null

afterEach(async () => {
  const current = rendered
  rendered = null
  await current?.dispose()
})

/** Stands in for the generated component that renders the design system root. */
function StyleRoot({ overlayContainer, children }: StyleRootProps): ReactNode {
  overlayContainer.setAttribute('data-style-root', '')
  return <div data-testid="style-root">{children}</div>
}

const probeWidget = createWidget({
  id: 'probe-widget',
  version: '1.2.0',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ changed: z.object({ value: z.string() }) }),
  render: ({ inputs }) => <span data-testid="widget-value">{inputs.value}</span>,
})

const probeApp = createApp({
  id: 'probe-app',
  version: '2.0.0',
  router: ({ basePath, history, context }: AppRouterOptions) =>
    createRouter({
      routeTree: createRootRoute({ component: () => <p data-testid="app-page">Page</p> }),
      basepath: basePath,
      history,
      context: { ...context },
    }),
})

describe('withStyleRoot', () => {
  it('produces a definition every part of the framework still recognises', () => {
    const wrapped = withStyleRoot(probeWidget, StyleRoot)

    expect(isMountableDefinition(wrapped)).toBe(true)
    expect(wrapped.id).toBe('probe-widget')
    expect(wrapped.kind).toBe('widget')
    expect(wrapped.version).toBe('1.2.0')
    expect(wrapped.contract).toBe(probeWidget.contract)
    expect(wrapped.render).toBe(probeWidget.render)
  })

  it('leaves the definition the author exported alone', () => {
    const wrapped = withStyleRoot(probeWidget, StyleRoot)

    expect(wrapped).not.toBe(probeWidget)
    rendered = renderWidget(probeWidget, { props: { value: 'plain' } })

    expect(screen.queryByTestId('style-root')).toBeNull()
    expect(screen.getByTestId('widget-value')).toHaveTextContent('plain')
  })
})

describe('a mount whose definition carries a style root', () => {
  it('renders it inside the scope root, around the Widget', () => {
    rendered = renderWidget(withStyleRoot(probeWidget, StyleRoot), { props: { value: 'styled' } })

    const styleRoot = screen.getByTestId('style-root')
    // The mount's overlay root carries the same attribute, as a sibling under the body.
    const scopeRoot = styleRoot.closest(`[${SCOPE_ATTRIBUTE}="probe-widget"]`)

    // Inside rather than around, so the scope element stays the framework's own anchor.
    expect(scopeRoot).not.toBeNull()
    expect(scopeRoot?.contains(styleRoot)).toBe(true)
    expect(styleRoot).toContainElement(screen.getByTestId('widget-value'))
  })

  it('hands it this mount own overlay root, which overlays portal into', () => {
    rendered = renderWidget(withStyleRoot(probeWidget, StyleRoot), { props: { value: 'styled' } })
    const { mount } = rendered.environment

    expect(mount.overlayRoot.getAttribute('data-style-root')).toBe('')
    expect(mount.overlayRoot.getAttribute(SCOPE_ATTRIBUTE)).toBe('probe-widget')
  })

  it('wraps an App the same way', async () => {
    const app = renderApp(withStyleRoot(probeApp, StyleRoot))
    rendered = app

    const styleRoot = await app.findByTestId('style-root')

    expect(styleRoot).toContainElement(await app.findByTestId('app-page'))
    expect(app.environment.mount.overlayRoot.getAttribute('data-style-root')).toBe('')
  })
})
