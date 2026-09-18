import { describe, expect, it } from 'vitest'

import { isMfeBuildError } from '../diagnostics.ts'
import { transformScopedCss } from './scope-transform.ts'

describe('transformScopedCss', () => {
  it('wraps rules in a scope with the nested lower boundary', () => {
    const result = transformScopedCss('.text-sm { font-size: 0.875rem; }', { scope: 'operations' })

    expect(result.css).toContain('@scope ([data-mfe-scope="operations"]) to ([data-mfe-scope])')
    expect(result.css).toContain('.text-sm')
  })

  it('leaves source class tokens unchanged', () => {
    const result = transformScopedCss('.card > .title:hover { color: red; }', { scope: 'ops' })

    expect(result.css).toContain('.card > .title:hover')
  })

  it('scopes to every definition the container exports', () => {
    const result = transformScopedCss('.a { color: red; }', { scope: ['ops', 'order-row'] })

    expect(result.css).toContain(
      '@scope ([data-mfe-scope="ops"], [data-mfe-scope="order-row"]) to ([data-mfe-scope])',
    )
  })

  it('rewrites reset selectors to the MFE root instead of emitting them globally', () => {
    const result = transformScopedCss(
      ':root { --gap: 4px; }\nhtml { font-size: 100%; }\nbody { margin: 0; }',
      { scope: 'ops' },
    )

    const scopeIndex = result.css.indexOf('@scope')
    expect(scopeIndex).toBeGreaterThanOrEqual(0)
    expect(result.css.slice(0, scopeIndex)).not.toContain(':root')
    expect(result.css).not.toMatch(/(^|[^:])\bhtml\b/)
    expect(result.css.match(/:scope/g)).toHaveLength(3)
  })

  it('emits the reset exactly once', () => {
    const result = transformScopedCss(':root { --gap: 4px; }', { scope: 'ops' })

    expect(result.css.match(/--gap/g)).toHaveLength(1)
    expect(result.css.match(/@scope/g)).toHaveLength(1)
  })

  it('namespaces keyframes and the declarations that reference them', () => {
    const result = transformScopedCss(
      '@keyframes spin { from { rotate: 0deg; } to { rotate: 360deg; } }\n.loader { animation: spin 1s linear infinite; }\n.other { animation-name: spin; }',
      { scope: 'ops' },
    )

    expect(result.keyframes).toEqual(['spin'])
    expect(result.css).toContain('@keyframes spin__ops')
    expect(result.css).toContain('animation: spin__ops 1s linear infinite')
    expect(result.css).toContain('animation-name: spin__ops')
    expect(result.css.indexOf('@keyframes')).toBeLessThan(result.css.indexOf('@scope'))
  })

  it('namespaces @font-face families rather than registering a page-wide name', () => {
    const result = transformScopedCss(
      "@font-face { font-family: 'Inter'; src: url(./inter.woff2); }\n.body { font-family: 'Inter', sans-serif; }",
      { scope: 'ops' },
    )

    expect(result.fontFamilies).toEqual(['Inter'])
    expect(result.css).toContain("font-family: 'Inter__ops'")
    expect(result.css).toContain("font-family: 'Inter__ops', sans-serif")
    expect(result.css).not.toContain("font-family: 'Inter';")
  })

  it('scopes nested at-rules in place', () => {
    const result = transformScopedCss('@media (min-width: 40rem) { .grid { display: grid; } }', {
      scope: 'ops',
    })

    expect(result.css.indexOf('@scope')).toBeLessThan(result.css.indexOf('@media'))
  })

  it('rejects @import', () => {
    expect(() => transformScopedCss("@import 'other.css';", { scope: 'ops' })).toThrow(/@import/)
  })

  it('rejects an unknown global at-rule with an actionable message', () => {
    try {
      transformScopedCss('@page { margin: 1cm; }', { scope: 'ops', from: '/app/src/app.css' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(isMfeBuildError(error)).toBe(true)
      expect((error as Error).message).toContain('/app/src/app.css')
      expect((error as Error).message).toContain('@page')
      expect((error as Error).message).toContain('shell')
    }
  })

  it('rejects a selector that reaches out of the MFE root', () => {
    expect(() => transformScopedCss('html.dark .card { color: red; }', { scope: 'ops' })).toThrow(
      /:scope/,
    )
    expect(() => transformScopedCss('.page body { margin: 0; }', { scope: 'ops' })).toThrow()
  })

  it('rejects an unprefixed registered property', () => {
    expect(() =>
      transformScopedCss('@property --brand { syntax: "<color>"; inherits: false; }', {
        scope: 'ops',
      }),
    ).toThrow(/--ops-brand/)

    expect(() =>
      transformScopedCss('@property --ops-brand { syntax: "<color>"; inherits: false; }', {
        scope: 'ops',
      }),
    ).not.toThrow()
  })

  it('reports an empty scope list', () => {
    expect(() => transformScopedCss('.a { color: red; }', { scope: [] })).toThrow(
      /at least one definition id/,
    )
  })
})
