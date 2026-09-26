/**
 * An agent's Image as the surface draws it: an `<img>` only for an address the deployment allows,
 * and otherwise text that says what and where, with nothing in the markup that would fetch it.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CATALOGUE_NAMES } from './catalogue.ts'
import { imageOrigins } from './model.ts'
import { A2uiSurface } from './surface.tsx'
import { A2uiSurfaces } from './surfaces.ts'

const PAGE = 'https://shell.test/operations'

function render(url: string, description = 'Well map'): string {
  const surfaces = new A2uiSurfaces()
  const error = surfaces.apply(
    'call-1',
    [
      { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'c' } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [{ id: 'root', component: 'Image', url, description }],
        },
      },
    ],
    CATALOGUE_NAMES,
  )
  if (error !== undefined) throw new Error(error.message)
  return renderToStaticMarkup(
    createElement(A2uiSurface, {
      surfaces,
      surfaceId: 's',
      handlers: { write: () => undefined, act: () => undefined },
      imageOrigins: imageOrigins('https://tiles.example.com'),
    }),
  )
}

describe('an A2UI Image', () => {
  const previous = globalThis.window
  beforeAll(() => {
    // The surface reads where the page is; the server renderer has no window of its own.
    Object.assign(globalThis, { window: { location: { href: PAGE } } })
  })
  afterAll(() => {
    Object.assign(globalThis, { window: previous })
  })

  it('loads from a host the deployment allows, sending no referrer', () => {
    const html = render('https://tiles.example.com/3/4/2.png')
    expect(html).toContain('<img src="https://tiles.example.com/3/4/2.png" alt="Well map"')
    expect(html).toContain('referrerPolicy="no-referrer"')
  })

  it('loads from the page’s own origin, and a data: image', () => {
    expect(render('/static/logo.png')).toContain('<img src="https://shell.test/static/logo.png"')
    expect(render('data:image/png;base64,iVBORw0KGgo=')).toContain(
      '<img src="data:image/png;base64,iVBORw0KGgo="',
    )
  })

  it('is text, with its description and host, from any other host', () => {
    const html = render('https://evil.example/p.gif?d=secret')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('evil.example/p.gif')
    expect(html).not.toContain('secret')
    expect(html).not.toContain('url(')
    expect(html).toContain('Image not shown: Well map')
    expect(html).toContain('From evil.example, which this deployment does not load images from')
  })

  it('is text without a host for a data: URL that is not an image, or a malformed address', () => {
    for (const url of ['data:text/html,<script>alert(1)</script>', 'http://[zz]/a.png']) {
      const html = render(url, '')
      expect(html).not.toContain('<img')
      expect(html).not.toContain('script')
      expect(html).toContain('Image not shown</p>')
      expect(html).not.toContain('From ')
    }
  })

  it('draws nothing with no address', () => {
    expect(render('')).not.toContain('Image')
  })
})
