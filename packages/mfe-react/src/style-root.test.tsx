/**
 * The style root: generated plumbing, so what is asserted here is the contract
 * the generated container entry relies on — the definition still looks like a
 * definition, and the mount renders the component inside the scope root with
 * this mount's overlay container.
 */

import { createRootRoute, createRouter } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ReactNode } from 'react'

import { createApp, createWidget, isMfeDefinition } from './definition.ts'
import { createMfeTestEnvironment, renderApp, type MfeTestEnvironment } from './testing/index.tsx'
import { SCOPE_ATTRIBUTE } from './scope-root.tsx'
import { withStyleRoot, type StyleRootProps } from './style-root.ts'
import { WidgetMount } from './widget-mount.tsx'
import type { AppRouterOptions } from './router-contract.ts'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = environment
  environment = null
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
  inputs: z.object({ value: z.string() }),
  events: { changed: z.object({ value: z.string() }) },
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

    expect(isMfeDefinition(wrapped)).toBe(true)
    expect(wrapped.id).toBe('probe-widget')
    expect(wrapped.kind).toBe('widget')
    expect(wrapped.version).toBe('1.2.0')
    expect(wrapped.contract).toBe(probeWidget.contract)
    expect(wrapped.render).toBe(probeWidget.render)
  })

  it('leaves the definition the author exported alone', () => {
    const wrapped = withStyleRoot(probeWidget, StyleRoot)

    expect(wrapped).not.toBe(probeWidget)
    environment = createMfeTestEnvironment({ definitionId: 'probe-widget', kind: 'widget' })

    render(
      <environment.wrapper>
        <WidgetMount
          definition={probeWidget}
          mount={environment.mount}
          inputs={{ value: 'plain' }}
          handlers={{}}
        />
      </environment.wrapper>,
    )

    expect(screen.queryByTestId('style-root')).toBeNull()
    expect(screen.getByTestId('widget-value')).toHaveTextContent('plain')
  })
})

describe('a mount whose definition carries a style root', () => {
  it('renders it inside the scope root, around the Widget', () => {
    environment = createMfeTestEnvironment({ definitionId: 'probe-widget', kind: 'widget' })
    const env = environment

    // Scoped to the rendered tree: the mount's overlay root carries the same
    // attribute, and it is a sibling of this container under the body.
    const { container } = render(
      <env.wrapper>
        <WidgetMount
          definition={withStyleRoot(probeWidget, StyleRoot)}
          mount={env.mount}
          inputs={{ value: 'styled' }}
          handlers={{}}
        />
      </env.wrapper>,
    )

    const styleRoot = screen.getByTestId('style-root')
    const scopeRoot = container.querySelector(`[${SCOPE_ATTRIBUTE}="probe-widget"]`)

    // Inside rather than around: the scope element stays the framework's own
    // anchor, and the generated root is what a container renders within it.
    expect(scopeRoot).not.toBeNull()
    expect(scopeRoot?.contains(styleRoot)).toBe(true)
    expect(styleRoot).toContainElement(screen.getByTestId('widget-value'))
  })

  it('hands it this mount own overlay root, which overlays portal into', () => {
    environment = createMfeTestEnvironment({ definitionId: 'probe-widget', kind: 'widget' })
    const env = environment

    render(
      <env.wrapper>
        <WidgetMount
          definition={withStyleRoot(probeWidget, StyleRoot)}
          mount={env.mount}
          inputs={{ value: 'styled' }}
          handlers={{}}
        />
      </env.wrapper>,
    )

    expect(env.mount.overlayRoot.getAttribute('data-style-root')).toBe('')
    expect(env.mount.overlayRoot.getAttribute(SCOPE_ATTRIBUTE)).toBe('probe-widget')
  })

  it('wraps an App the same way', async () => {
    const rendered = renderApp(withStyleRoot(probeApp, StyleRoot))

    try {
      const styleRoot = await rendered.findByTestId('style-root')

      expect(styleRoot).toContainElement(await rendered.findByTestId('app-page'))
      expect(rendered.environment.mount.overlayRoot.getAttribute('data-style-root')).toBe('')
    } finally {
      await rendered.dispose()
    }
  })
})
