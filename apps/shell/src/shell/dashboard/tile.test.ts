import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type * as MfeReact from '@company/mfe-react'
import type { RegistryEntry } from '@company/mfe-react'
import { describe, expect, it, vi } from 'vitest'

import { Tile } from './tile.tsx'

/** The props each `DynamicWidget` was rendered with. */
const rendered: Record<string, unknown>[] = []

vi.mock('@company/mfe-react', async importOriginal => ({
  ...(await importOriginal<typeof MfeReact>()),
  DynamicWidget: (props: Record<string, unknown>) => {
    rendered.push(props)
    return null
  },
}))

const entry: RegistryEntry = {
  id: 'operations/alert-panel',
  definitionKind: 'widget',
  adapter: 'react',
  manifestUrl: 'https://example.test/mf-manifest.json',
  requiresRuntime: '^0.1.0',
}

describe('a dashboard tile', () => {
  it('mounts the tile’s own Widget with its inputs, never a stored name the host owns', () => {
    const noop = (): void => undefined
    renderToStaticMarkup(
      createElement(Tile, {
        tile: {
          key: 'tile-1',
          widgetId: 'operations/alert-panel',
          x: 0,
          y: 0,
          w: 4,
          h: 3,
          inputs: { siteId: 'S-1', widgetId: 'other/widget', fallback: 'x', onOutput: 'x' },
        },
        entry,
        rect: { x: 0, y: 0, w: 4, h: 3 },
        isMoving: false,
        onConfigure: noop,
        onRemove: noop,
        onResize: noop,
        onOutput: noop,
        onMoveStart: noop,
        onResizeStart: noop,
        onKeyDown: noop,
      }),
    )

    const [props] = rendered
    expect(props?.['widgetId']).toBe('operations/alert-panel')
    expect(props?.['siteId']).toBe('S-1')
    expect(typeof props?.['fallback']).toBe('function')
    expect(typeof props?.['onOutput']).toBe('function')
  })
})
