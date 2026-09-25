import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { linkTarget, Markdown } from './markdown.tsx'

const BASE = 'http://localhost:3000/operations'

describe('linkTarget', () => {
  it('keeps a link to this application in the page, with its query and hash', () => {
    expect(linkTarget('/wells/W-1?tab=logs#top', BASE)).toEqual({
      kind: 'page',
      path: '/wells/W-1?tab=logs#top',
    })
    expect(linkTarget('http://localhost:3000/reports', BASE)).toEqual({
      kind: 'page',
      path: '/reports',
    })
  })

  it('sends any other web or mail address away, and anything else nowhere', () => {
    expect(linkTarget('https://example.com/a', BASE)).toMatchObject({ kind: 'away' })
    expect(linkTarget('mailto:ops@example.com', BASE)).toMatchObject({ kind: 'away' })
    expect(linkTarget('ftp://example.com/file', BASE)).toBeUndefined()
    expect(linkTarget('', BASE)).toBeUndefined()
    expect(linkTarget(undefined, BASE)).toBeUndefined()
  })
})

describe('Markdown', () => {
  const previous = globalThis.window
  beforeAll(() => {
    // Links and images read where the page is; the server renderer has no window of its own.
    Object.assign(globalThis, { window: { location: { href: BASE } } })
  })
  afterAll(() => {
    Object.assign(globalThis, { window: previous })
  })

  const render = (markdown: string): string =>
    renderToStaticMarkup(createElement(Markdown, { go: async () => undefined, children: markdown }))

  it('draws lists, emphasis, tables and code rather than their marks', () => {
    const html = render(
      '**Two** wells:\n\n- W-1\n- W-2\n\n| Well | Rate |\n| --- | ---: |\n| W-1 | 12 |\n\n```\nshut_in W-1\n```',
    )

    expect(html).toContain('<strong>Two</strong>')
    expect(html).toContain('<li>W-1</li>')
    expect(html).toContain('<table')
    expect(html).toContain('text-align:right')
    expect(html).toContain('shut_in W-1')
    expect(html).toContain('aria-label="Copy the code"')
    expect(html).not.toContain('**')
  })

  it('keeps a page link in the application and opens any other in a new tab, saying where', () => {
    const html = render('[the wells](/operations/wells) and [the spec](https://example.com/spec)')

    expect(html).toContain('href="/operations/wells"')
    expect(html).not.toMatch(/href="\/operations\/wells"[^>]*target=/)
    expect(html).toMatch(
      /href="https:\/\/example.com\/spec"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
    )
    expect(html).toContain('opens example.com in a new tab')
  })

  it('renders no raw HTML, no script link and no image', () => {
    const html = render(
      '<b>raw</b> [run](javascript:alert(1)) ![chart](https://evil.example/p.gif?d=secret)',
    )

    expect(html).not.toContain('<b>')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<img')
    expect(html).toContain('Image not shown: chart (evil.example)')
  })
})
