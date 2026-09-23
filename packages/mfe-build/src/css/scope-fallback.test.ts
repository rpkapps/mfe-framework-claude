import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

import { isMfeBuildError } from '../diagnostics.ts'
import { scopeFallbackPlugin } from './scope-fallback.ts'

const STYLESHEET = '/app/.mfe/styles.css'

const SCOPE = '@scope ([data-mfe-scope="ops"]) to ([data-mfe-scope])'

/** PostCSS re-derives indentation from the input, so the tests compare the CSS, not its layout. */
function compact(css: string): string {
  return css.replace(/\s+/g, ' ').trim()
}

function scope(css: string, ids: readonly string[] = ['ops']): string {
  const plugin = scopeFallbackPlugin({
    scope: ids.map(id => `[data-mfe-scope="${id}"]`).join(', '),
    boundary: '[data-mfe-scope]',
    keyframes: { suffix: ids.join('-') },
  })
  return postcss([plugin]).process(css, { from: STYLESHEET }).css
}

describe('scopeFallbackPlugin', () => {
  it("confines a run of rules to the container's mount roots in one @scope", () => {
    expect(compact(scope('.a { color: red; }\n.b { color: blue; }\n'))).toBe(
      `${SCOPE} { .a { color: red; } .b { color: blue; } }`,
    )
  })

  it('names every definition the container exports, bounded by any mount root below', () => {
    expect(scope('.a { color: red; }', ['ops', 'order-row'])).toContain(
      '@scope ([data-mfe-scope="ops"], [data-mfe-scope="order-row"]) to ([data-mfe-scope]) {',
    )
  })

  it('keeps a scoped run inside the layer and the condition it was written in', () => {
    const result = scope(
      '@layer utilities {\n  .p-4 { padding: 1rem; }\n  @media (width >= 40rem) {\n    .sm { padding: 2px; }\n  }\n}\n',
    )

    expect(compact(result)).toBe(
      [
        '@layer utilities {',
        `${SCOPE} { .p-4 { padding: 1rem; } }`,
        `@media (width >= 40rem) { ${SCOPE} { .sm { padding: 2px; } } }`,
        '}',
      ].join(' '),
    )
  })

  it('makes each keyframes name it defines unique on the page, and every use of it', () => {
    const result = scope(
      [
        ':root { --animate-shimmer: shimmer 2s linear infinite; }',
        '.a { animation: shimmer 2s; animation-name: shimmer; }',
        '.b { animation: spin 1s; }',
        '@-webkit-keyframes shimmer { from { opacity: 0; } }',
        '@keyframes shimmer { from { opacity: 0; } }',
      ].join('\n'),
      ['ops', 'order-row'],
    )

    expect(result).toContain('@-webkit-keyframes shimmer--ops-order-row {')
    expect(result).toContain('@keyframes shimmer--ops-order-row {')
    expect(result).toContain('--animate-shimmer: shimmer--ops-order-row 2s linear infinite;')
    expect(result).toContain('animation: shimmer--ops-order-row 2s;')
    expect(result).toContain('animation-name: shimmer--ops-order-row;')
    // Defined elsewhere, so not this stylesheet's to rename.
    expect(result).toContain('animation: spin 1s;')
  })

  it('reads :root and :host as the scope root, once', () => {
    const result = scope(':root, :host { --spacing: 0.25rem; }\n')

    expect(compact(result)).toBe(`${SCOPE} { :scope { --spacing: 0.25rem; } }`)
  })

  it('maps zero-specificity html token declarations to the scope root', () => {
    const result = scope(':where(html) { --size: 1rem; }\n')

    expect(compact(result)).toBe(`${SCOPE} { :where(:scope) { --size: 1rem; } }`)
  })

  it('leaves page-wide definitions outside @scope, after the imports and the layer order', () => {
    const result = scope(
      [
        '@charset "utf-8";',
        '@import "base.css";',
        '@layer theme, utilities;',
        '.a { color: red; }',
        '@property --x { syntax: "*"; inherits: false; }',
        '@font-face { font-family: Brand; src: url(brand.woff2); }',
        '@keyframes pulse { to { opacity: 0; } }',
        '.b { color: blue; }',
      ].join('\n'),
    )

    expect(compact(result)).toBe(
      [
        '@charset "utf-8";',
        '@import "base.css";',
        '@layer theme, utilities;',
        '@property --x { syntax: "*"; inherits: false; }',
        '@font-face { font-family: Brand; src: url(brand.woff2); }',
        '@keyframes pulse--ops { to { opacity: 0; } }',
        `${SCOPE} { .a { color: red; } .b { color: blue; } }`,
      ].join(' '),
    )
  })

  it('leaves a stylesheet of comments alone, since it has nothing to scope', () => {
    expect(scope('/* nothing here */\n')).toBe('/* nothing here */\n')
  })

  it('accepts a class that only mentions the document elements in its name', () => {
    expect(scope('.html-view .body-copy { color: red; }')).toContain('.html-view .body-copy')
  })

  it('fails the build for a selector that reaches the document, naming the line', () => {
    try {
      scope('.a { color: red; }\n.page body { margin: 0; }')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(isMfeBuildError(error)).toBe(true)
      expect((error as Error).message).toContain(`${STYLESHEET}:2:1`)
      expect((error as Error).message).toContain('.page body, which reaches the document')
    }
  })
})
