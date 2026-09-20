/**
 * Native `@scope` output for a container's CSS. The lower boundary is what
 * stops a parent App's rules matching inside a nested App's root; `@scope` does
 * not block inheritance, so shell fonts and theme values still flow down.
 * There is no fallback mode, no feature detection and no per-MFE opt-out.
 *
 * It runs as a PostCSS plugin, after `@tailwindcss/postcss`, so what it sees is
 * one container's finished stylesheet: layer statements, a theme block, the
 * utilities it generated, the registered properties its utilities read back and
 * the keyframes they animate.
 *
 * Two things a browser ignores inside `@scope` decide the shape of the output.
 * A rule whose selector leads with `:root`, `html` or `body` is rewritten to
 * `:scope`, so the container's own theme defaults — `--spacing`, the `--text-*`
 * scale, the `--animate-*` names — land on its scope root and inherit into it
 * and into its overlay root, rather than on the document where they would meet
 * the shell's. And an at-rule that is global by nature is left outside the
 * wrapper, in the place and under the conditions it was written.
 *
 * That last one is the stated limit: `@property`, `@keyframes` and `@font-face`
 * register a name for the whole page, and two containers registering the same
 * name end up with whichever the browser parsed last. They are deliberately not
 * renamed. Tailwind's utilities read back the `--tw-*` properties it registers
 * and `tw-animate-css` names its keyframes through `--animate-*` variables, so
 * renaming either leaves the CSS that refers to it pointing at nothing. The
 * names come from Tailwind and from the shared design system, which is why the
 * definitions behind them agree in practice.
 */

import postcss, { AtRule, type ChildNode, type Container, type Plugin, type Root } from 'postcss'

import { createBuildError, listNames } from '../diagnostics.ts'

const SCOPE_ATTRIBUTE = 'data-mfe-scope'

export interface ScopedCssOptions {
  /** The definition id, or ids, this stylesheet is scoped to. */
  readonly scope: string | readonly string[]
  /** File name, for diagnostics. */
  readonly from?: string
}

/** At-rules whose body is scoped in place, one `@scope` per run of children. */
const NESTABLE_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'starting-style'])

/** At-rules a browser ignores inside `@scope`, so they stay outside it. */
const GLOBAL_AT_RULES = new Set([
  'charset',
  'import',
  'property',
  'font-face',
  'keyframes',
  '-webkit-keyframes',
])

/** At-rules that are global by nature and have no scoped equivalent. */
const REJECTED_AT_RULES: ReadonlyMap<string, string> = new Map([
  ['namespace', 'Delete it. XML namespaces apply to the whole document, not to one MFE.'],
  [
    'page',
    'Move print page styling to the shell. An MFE cannot own the margins of a page it shares.',
  ],
  [
    'counter-style',
    'Use a built-in list style, or ask the shell to register the counter style once for the page.',
  ],
  ['font-feature-values', 'Use the font feature properties directly in a scoped rule instead.'],
  [
    'scope',
    'Remove it. The build already wraps this stylesheet in the container scope, and a nested @scope would fight the lower boundary that separates nested Apps.',
  ],
])

/** Selectors that reach outside the MFE root. */
const LEADING_ROOT_PATTERN = /^(?::root|html|body)(?=\s|[>+~]|$)/
const GLOBAL_ROOT_PATTERN = /(^|[\s>+~,(])(:root|:host|html|body)(?![\w-])/
/** Tailwind writes its theme block as `:root, :host`; only the first can match. */
const HOST_ONLY_PATTERN = /^:host(?:\([^)]*\))?$/

/**
 * The PostCSS plugin the build registers, which is where scoping actually
 * happens: it runs on each stylesheet the container compiles, after Tailwind
 * has expanded it and before anything concatenates or minifies it.
 */
export function scopedCssPlugin(options: ScopedCssOptions): Plugin {
  const scopes = resolveScopes(options)

  return {
    postcssPlugin: 'mfe-scoped-css',
    OnceExit(root) {
      scopeStylesheet(root, scopes, options.from ?? root.source?.input.from ?? '<stylesheet>')
    },
  }
}

/**
 * The same rewrite over a string, on the same AST pass the plugin uses. It is
 * what makes the transform testable without running a build.
 */
export function transformScopedCss(css: string, options: ScopedCssOptions): string {
  const file = options.from ?? '<stylesheet>'
  const scopes = resolveScopes(options)

  let root: Root
  try {
    root = postcss.parse(css, { from: options.from })
  } catch (cause) {
    throw createBuildError({
      file,
      operation: 'parse this stylesheet',
      expected: 'valid CSS',
      observed: cause instanceof Error ? cause.message : 'a parse failure',
      declaredBy: 'The scoped CSS transform',
      repair: 'Fix the syntax error the parser reports above, then rebuild.',
      cause,
    })
  }

  scopeStylesheet(root, scopes, file)

  // Moved nodes keep the indentation they were parsed with, which would leave
  // the wrapped rules a level short of where they now sit.
  root.cleanRaws()
  return root.toString()
}

function resolveScopes(options: ScopedCssOptions): readonly string[] {
  const scopes = typeof options.scope === 'string' ? [options.scope] : [...options.scope]
  if (scopes.length > 0) return scopes

  throw createBuildError({
    file: options.from ?? '<stylesheet>',
    operation: 'scope this stylesheet',
    expected: 'at least one definition id to scope to',
    observed: 'an empty scope list',
    declaredBy: 'The scoped CSS transform',
    repair:
      'Pass the ids of the definitions this container exports. They are the values the mount roots carry in their data-mfe-scope attribute.',
  })
}

function scopeStylesheet(root: Root, scopes: readonly string[], file: string): void {
  rejectUnsupportedAtRules(root, file)
  scopeChildren(root, scopes, file)
}

function rejectUnsupportedAtRules(root: Root, file: string): void {
  root.walkAtRules(atRule => {
    const name = atRule.name.toLowerCase()

    const repair = REJECTED_AT_RULES.get(name)
    if (repair !== undefined) {
      throw createBuildError({
        file,
        ...positionOf(atRule),
        operation: 'scope this stylesheet',
        expected: 'CSS the container scope can contain',
        observed: `@${atRule.name}, which is global to the page`,
        declaredBy: 'The scoped CSS transform',
        repair,
      })
    }

    if (NESTABLE_AT_RULES.has(name) || GLOBAL_AT_RULES.has(name)) return

    throw createBuildError({
      file,
      ...positionOf(atRule),
      operation: 'scope this stylesheet',
      expected: `an at-rule the transform knows how to scope (${listNames([
        ...NESTABLE_AT_RULES,
        ...GLOBAL_AT_RULES,
      ])})`,
      observed: `@${atRule.name}`,
      declaredBy: 'The scoped CSS transform',
      repair:
        'Remove it, or move it to the shell stylesheet if it really has to be page-wide. The transform refuses at-rules it cannot prove are contained, rather than emitting them as page-wide globals.',
    })
  })
}

/**
 * Wraps each run of scopable children in its own `@scope`, so a rule keeps the
 * layer and the conditions it was written under: `@layer utilities` stays a
 * layer holding scoped rules rather than becoming a scope holding a layer.
 * Anything global to the document ends the current run and stays where it is.
 */
function scopeChildren(container: Container, scopes: readonly string[], file: string): void {
  let run: ChildNode[] = []

  const flush = (): void => {
    const [first] = run
    if (first === undefined) return

    const wrapper = new AtRule({ name: 'scope', params: scopeParams(scopes) })
    container.insertBefore(first, wrapper)
    wrapper.append(run)
    wrapper.walkRules(rule => {
      rule.selector = rewriteSelectorList(rule.selector, rule, file, scopes)
    })
    run = []
  }

  // Copied, because wrapping a run moves nodes out of this list.
  for (const node of [...(container.nodes ?? [])]) {
    if (node.type === 'atrule') {
      const name = node.name.toLowerCase()
      // A bodiless at-rule is a statement — `@layer a, b;` declares layer order
      // for the document — and has nothing to scope.
      if (node.nodes === undefined || GLOBAL_AT_RULES.has(name)) {
        flush()
        continue
      }
      if (NESTABLE_AT_RULES.has(name)) {
        flush()
        scopeChildren(node, scopes, file)
        continue
      }
    }

    // A comment before the first rule is the stylesheet's, not a scoped rule's.
    if (node.type === 'comment' && run.length === 0) continue

    run.push(node)
  }

  flush()
}

function scopeParams(scopes: readonly string[]): string {
  const start = scopes.map(scope => `[${SCOPE_ATTRIBUTE}="${scope}"]`).join(', ')
  return `(${start}) to ([${SCOPE_ATTRIBUTE}])`
}

function rewriteSelectorList(
  selector: string,
  node: ChildNode,
  file: string,
  scopes: readonly string[],
): string {
  const rewritten: string[] = []

  for (const part of splitSelectorList(selector)) {
    const next = rewriteSelector(part, node, file, scopes)
    if (next !== null && !rewritten.includes(next)) rewritten.push(next)
  }

  // Everything was a shadow host, so the declarations belong to the root alone.
  return rewritten.length === 0 ? ':scope' : rewritten.join(', ')
}

/**
 * A reset written against `:root`, `html` or `body` becomes `:scope`, so it
 * applies at the MFE root instead of the document. `:host` is dropped: Tailwind
 * pairs the two in its theme block for an application that may be rendered in a
 * shadow root, and a container never is. Anything else naming those is a build
 * error: inside `@scope` every selector is relative to the scope root, so it
 * would silently become dead CSS rather than a global.
 */
function rewriteSelector(
  selector: string,
  node: ChildNode,
  file: string,
  scopes: readonly string[],
): string | null {
  const trimmed = selector.trim()
  if (HOST_ONLY_PATTERN.test(trimmed)) return null

  const leading = LEADING_ROOT_PATTERN.exec(trimmed)
  const rewritten =
    leading === null ? trimmed : `:scope${trimmed.slice(leading[0].length)}`.trimEnd()

  const offender = GLOBAL_ROOT_PATTERN.exec(rewritten)
  if (offender !== null) {
    throw createBuildError({
      file,
      ...positionOf(node),
      operation: 'scope this stylesheet',
      expected: 'a selector contained by the MFE root',
      observed: `'${trimmed}', whose '${offender[2] ?? ''}' reaches the document`,
      declaredBy: 'The scoped CSS transform',
      repair: `Write it against the MFE root instead, for example \`:scope[data-theme="dark"] .card\`. Inside @scope every selector is relative to [data-mfe-scope="${scopes[0] ?? 'your-app'}"], so this one would never match.`,
    })
  }

  return rewritten
}

/** Splits a selector list on top-level commas, so `:is(a, b)` survives. */
function splitSelectorList(selector: string): readonly string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''

  for (const character of selector) {
    if (quote !== null) {
      current += character
      if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      current += character
      continue
    }
    if (character === '(' || character === '[') depth += 1
    if (character === ')' || character === ']') depth -= 1
    if (character === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += character
  }

  parts.push(current.trim())
  return parts.filter(part => part !== '')
}

function positionOf(node: ChildNode): { readonly line?: number; readonly column?: number } {
  const start = node.source?.start
  return start === undefined ? {} : { line: start.line, column: start.column }
}
