import { fileURLToPath } from 'node:url'

import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

import { containerScopePlugin, isMfeBuildError } from '@company/mfe-build'

import { loadScopePlugin } from './scope.ts'

/** This package declares the design system as an optional peer, so its copy scopes here. */
const CONTAINER_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const STYLESHEET = '/app/.mfe/styles.css'

/** The shape Tailwind v4 actually emits for a container. */
const TAILWIND_OUTPUT = `@layer properties;
@layer theme, base, components, utilities;
@layer theme {
  :root, :host {
    --spacing: 0.25rem;
    --animate-shimmer: shimmer 2s linear infinite;
  }
}
@layer utilities {
  .p-4 {
    padding: calc(var(--spacing) * 4);
  }
}
@property --tw-translate-x {
  syntax: "*";
  inherits: false;
  initial-value: 0;
}
.shimmer {
  animation: shimmer 2s linear infinite;
}
@keyframes shimmer {
  from { background-position: 0 0; }
  to { background-position: 100% 0; }
}
`

function scope(css: string, scopes: readonly string[]): string {
  return postcss([
    containerScopePlugin({ scopes, containerRoot: CONTAINER_ROOT, loadScopePlugin }),
  ]).process(css, { from: STYLESHEET }).css
}

/** The text between a heading and its closing brace. */
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

describe("the design system's scope plugin", () => {
  it('scopes a container to its mount roots, bounded by the next one below', () => {
    const result = scope('.text-sm { font-size: 0.875rem; }', ['operations'])

    expect(result).toContain('@scope ([data-mfe-scope="operations"]) to ([data-mfe-scope])')
    expect(result).toContain('.text-sm')
  })

  it('names every definition the container exports in the scope', () => {
    const result = scope('.a { color: red; }', ['ops', 'order-row'])

    expect(result).toContain(
      '@scope ([data-mfe-scope="ops"], [data-mfe-scope="order-row"]) to ([data-mfe-scope])',
    )
  })

  it('versions the keyframes it defines with the ids, joined', () => {
    const result = scope(TAILWIND_OUTPUT, ['ops', 'order-row'])

    expect(result).toContain('@keyframes shimmer--ops-order-row')
    expect(result).toContain('--animate-shimmer: shimmer--ops-order-row 2s linear infinite')
    expect(result).toContain('animation: shimmer--ops-order-row 2s linear infinite')
  })

  it('keeps a scoped run inside the layer it was written in', () => {
    const result = scope(TAILWIND_OUTPUT, ['operations'])
    const utilities = block(result, '@layer utilities {')

    expect(utilities).toContain('@scope ([data-mfe-scope="operations"]) to ([data-mfe-scope])')
    expect(utilities.indexOf('@scope')).toBeLessThan(utilities.indexOf('.p-4'))
  })

  it('moves the theme defaults onto the container root and hoists the globals', () => {
    const result = scope(TAILWIND_OUTPUT, ['operations'])

    expect(block(result, '@layer theme {')).toContain(':scope {')
    expect(result).not.toContain(':root')
    expect(result).not.toContain(':host')
    // Meaningless inside `@scope`, so they sit above the first one.
    for (const global of ['@property --tw-translate-x', '@keyframes shimmer--operations']) {
      expect(result.indexOf(global), global).toBeLessThan(result.indexOf('@scope'))
    }
  })

  it('fails the build for a selector that reaches the document, naming the line', () => {
    expect(() => scope('.a { color: red; }\n.page body { margin: 0; }', ['ops'])).toThrow(
      new RegExp(`${STYLESHEET}:2`),
    )
  })

  it('reports a container with no definitions to scope to', () => {
    try {
      scope('.a { color: red; }', [])
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(isMfeBuildError(error)).toBe(true)
      expect((error as Error).message).toContain('at least one definition id')
      expect((error as Error).message).toContain('data-mfe-scope')
    }
  })
})
