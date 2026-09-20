import { describe, expect, it } from 'vitest'

import { isMfeBuildError } from '../diagnostics.ts'
import { transformScopedCss } from './scope-transform.ts'

/**
 * The shape Tailwind v4 actually emits for a container: a layer statement, the
 * theme defaults as `:root, :host`, the utilities in their layer, the custom
 * properties those utilities read back, the keyframes they animate, an
 * unlayered rule from the vendored shadcn styles and the conditional block
 * beside it.
 */
const TAILWIND_OUTPUT = `@layer properties;
@layer theme, base, components, utilities;
@layer theme {
  :root, :host {
    --spacing: 0.25rem;
    --text-xs: 0.75rem;
  }
}
@layer utilities {
  .p-4 {
    padding: calc(var(--spacing) * 4);
  }
  @media (hover: hover) {
    .hover\\:p-2:hover {
      padding: calc(var(--spacing) * 2);
    }
  }
}
@property --tw-translate-x {
  syntax: "*";
  inherits: false;
  initial-value: 0;
}
.shimmer {
  animation: tw-shimmer 2s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .shimmer {
    animation: none;
  }
}
@keyframes tw-shimmer {
  from { background-position: 0 0; }
  to { background-position: 100% 0; }
}
@layer properties {
  @supports ((-webkit-hyphens: none)) {
    :root, :host {
      --shimmer-angle: 20deg;
    }
    *, ::before, ::after, ::backdrop {
      --tw-translate-x: 0;
    }
  }
}
`

const SCOPE = '@scope ([data-mfe-scope="operations"]) to ([data-mfe-scope])'

/** The text between the nth occurrence of a heading and its closing brace. */
function block(css: string, opening: string): string {
  const start = css.indexOf(opening)
  expect(start, opening).toBeGreaterThanOrEqual(0)

  let depth = 0
  for (let index = start; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(start, index + 1)
    }
  }
  throw new Error(`unterminated block: ${opening}`)
}

describe('transformScopedCss', () => {
  it('wraps rules in a scope with the nested lower boundary', () => {
    const result = transformScopedCss('.text-sm { font-size: 0.875rem; }', { scope: 'operations' })

    expect(result).toContain(SCOPE)
    expect(result).toContain('.text-sm')
  })

  it('leaves source class tokens unchanged', () => {
    const result = transformScopedCss('.card > .title:hover { color: red; }', { scope: 'ops' })

    expect(result).toContain('.card > .title:hover')
  })

  it('scopes to every definition the container exports', () => {
    const result = transformScopedCss('.a { color: red; }', { scope: ['ops', 'order-row'] })

    expect(result).toContain(
      '@scope ([data-mfe-scope="ops"], [data-mfe-scope="order-row"]) to ([data-mfe-scope])',
    )
  })

  it('rewrites reset selectors to the MFE root instead of emitting them globally', () => {
    const result = transformScopedCss(
      ':root { --gap: 4px; }\nhtml { font-size: 100%; }\nbody { margin: 0; }',
      { scope: 'ops' },
    )

    const scopeIndex = result.indexOf('@scope')
    expect(scopeIndex).toBeGreaterThanOrEqual(0)
    expect(result.slice(0, scopeIndex)).not.toContain(':root')
    expect(result).not.toMatch(/(^|[^:])\bhtml\b/)
    expect(result.match(/:scope/g)).toHaveLength(3)
  })

  it('emits the reset exactly once', () => {
    const result = transformScopedCss(':root { --gap: 4px; }', { scope: 'ops' })

    expect(result.match(/--gap/g)).toHaveLength(1)
    expect(result.match(/@scope/g)).toHaveLength(1)
  })

  /**
   * Tailwind writes its theme defaults for an application that may be rendered
   * into a shadow root. A container never is, and inside `@scope` the shadow
   * half matches nothing at all, so it is dropped rather than refused.
   */
  it('keeps the scope root half of a `:root, :host` theme block and drops the other', () => {
    const result = transformScopedCss(':root, :host { --spacing: 0.25rem; }', { scope: 'ops' })

    expect(result).toContain(':scope {')
    expect(result).not.toContain(':host')
    expect(result.match(/--spacing/g)).toHaveLength(1)
  })

  it('scopes a run of children inside the layer they were written in', () => {
    const result = transformScopedCss(TAILWIND_OUTPUT, { scope: 'operations' })
    const utilities = block(result, '@layer utilities {')

    // The layer holds the scope, not the other way round: a container's
    // utilities have to stay in the layer the page ordered them in.
    expect(utilities.indexOf(SCOPE)).toBeGreaterThanOrEqual(0)
    expect(utilities.indexOf(SCOPE)).toBeLessThan(utilities.indexOf('.p-4'))
  })

  it('scopes each run inside a conditional at-rule separately', () => {
    const result = transformScopedCss(TAILWIND_OUTPUT, { scope: 'operations' })
    const hover = block(result, '@media (hover: hover) {')

    expect(hover).toContain(SCOPE)
    expect(hover.indexOf('@media')).toBeLessThan(hover.indexOf('@scope'))
  })

  it('recurses through a layer and the supports query inside it', () => {
    const result = transformScopedCss(TAILWIND_OUTPUT, { scope: 'operations' })
    const supports = block(result, '@supports ((-webkit-hyphens: none)) {')

    expect(supports).toContain(SCOPE)
    expect(supports).toContain(':scope {')
    expect(supports).toContain('*, ::before, ::after, ::backdrop')
    expect(supports).not.toContain(':host')
  })

  /**
   * A browser ignores these inside `@scope`, and renaming them is worse than
   * the collision it would avoid: Tailwind's utilities read back the `--tw-*`
   * properties it registers, and the animation utilities name their keyframes
   * through variables the rename would not follow.
   */
  it('leaves the document-global at-rules outside the scope, unchanged', () => {
    const result = transformScopedCss(TAILWIND_OUTPUT, { scope: 'operations' })

    for (const global of [
      '@layer properties;',
      '@layer theme, base, components, utilities;',
      '@property --tw-translate-x',
      '@keyframes tw-shimmer',
    ]) {
      const index = result.indexOf(global)
      expect(index, global).toBeGreaterThanOrEqual(0)
      expect(block(result, SCOPE).includes(global), global).toBe(false)
    }

    expect(result).toContain('animation: tw-shimmer 2s linear infinite')
  })

  it('leaves the selectors inside a keyframes rule alone', () => {
    const result = transformScopedCss(TAILWIND_OUTPUT, { scope: 'operations' })
    const keyframes = block(result, '@keyframes tw-shimmer {')

    expect(keyframes).toContain('from')
    expect(keyframes).toContain('to')
    expect(keyframes).not.toContain(':scope')
  })

  it('wraps an unlayered rule and the conditional block beside it', () => {
    const result = transformScopedCss(TAILWIND_OUTPUT, { scope: 'operations' })
    const reduced = block(result, '@media (prefers-reduced-motion: reduce) {')

    expect(reduced).toContain(SCOPE)
    expect(reduced).toContain('.shimmer')
    // The unlayered `.shimmer` rule above it is scoped too, or it would reach
    // the shell's markup from the page-level cascade.
    expect(result.match(/\.shimmer/g)).toHaveLength(2)
    expect(result.match(/@scope/g)?.length).toBeGreaterThanOrEqual(5)
  })

  it('passes an @import and an @font-face through without scoping them', () => {
    const result = transformScopedCss(
      "@import 'other.css';\n@font-face { font-family: 'Inter'; src: url(./inter.woff2); }\n.body { font-family: 'Inter', sans-serif; }",
      { scope: 'ops' },
    )

    expect(result).toContain("@import 'other.css'")
    expect(result).toContain("font-family: 'Inter'")
    expect(result.indexOf('@font-face')).toBeLessThan(result.indexOf('@scope'))
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

  it('rejects an author-written @scope, which would fight the lower boundary', () => {
    expect(() =>
      transformScopedCss('@scope (.card) { .a { color: red; } }', { scope: 'ops' }),
    ).toThrow(/lower boundary/)
  })

  it('rejects a selector that reaches out of the MFE root', () => {
    expect(() => transformScopedCss('html.dark .card { color: red; }', { scope: 'ops' })).toThrow(
      /:scope/,
    )
    expect(() => transformScopedCss('.page body { margin: 0; }', { scope: 'ops' })).toThrow()
  })

  it('reports an empty scope list', () => {
    expect(() => transformScopedCss('.a { color: red; }', { scope: [] })).toThrow(
      /at least one definition id/,
    )
  })
})
