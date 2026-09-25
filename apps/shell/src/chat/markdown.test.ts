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
    expect(linkTarget(null, BASE)).toBeUndefined()
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

  it('reads GitHub’s flavour: strikethrough, task lists, pipeless tables and bare links', () => {
    const html = render(
      '~~old~~ well_id_here and www.example.com\n\n- [ ] open\n- [x] done\n\nWell | Rate\n--- | :---:\nW-1 | 12',
    )

    expect(html).toContain('<del>old</del>')
    expect(html).toContain('well_id_here')
    expect(html).not.toContain('<em>')
    expect(html).toContain('href="http://www.example.com/"')
    expect(html).toMatch(/<ul class="flex flex-col gap-1">/)
    expect(html).toMatch(/<input type="checkbox" disabled=""\/> open/)
    expect(html).toMatch(/<input type="checkbox" disabled="" checked=""\/> done/)
    expect(html).toContain('text-align:center')
  })

  it('draws a reply of one line as a paragraph, and one starting with a rule as a rule', () => {
    expect(render('Hello.')).toContain('<p>Hello.</p>')
    expect(render('---\ntitle: x\n---\nbody')).toMatch(/<hr[^>]*\/>.*title: x.*<p>body<\/p>/)
  })

  it('draws a code block from its text, whatever its fence names, and inline code apart', () => {
    const html = render(
      'Run `shut_in`:\n\n```sh style="color:red" onclick=alert(1)\nshut_in W-1\n```',
    )

    expect(html).toContain(
      'rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]">shut_in</code>',
    )
    expect(html).toContain('<pre class="overflow-x-auto')
    expect(html).toMatch(/<pre[^>]*><code>shut_in W-1<\/code><\/pre>/)
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('color:red')
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

  it('renders no raw HTML, no script or data link and no image', () => {
    const html = render(
      [
        '<b>raw</b> [run](javascript:alert(1)) [page](data:text/html,x) <javascript:alert(1)>',
        '![chart](https://evil.example/p.gif?d=secret)',
        '<div onclick="alert(1)">block</div>',
        '<iframe src="https://evil.example"></iframe><script>alert(1)</script><style>*{}</style>',
        '<a href="javascript:alert(1)">x</a> <img src=x onerror=alert(1)>',
      ].join('\n\n'),
    )

    for (const tag of [
      '<b>',
      '<div onclick',
      '<iframe',
      '<script',
      '<style',
      '<img',
      '<a href="java',
    ]) {
      expect(html).not.toContain(tag)
    }
    expect(html).not.toMatch(/href="(javascript|data):/)
    expect(html).toContain('&lt;b&gt;raw&lt;/b&gt;')
    expect(html).toContain('Image not shown: chart (evil.example)')
  })
})
