/**
 * Native `@scope` output for a container's CSS. The lower boundary is what
 * stops a parent App's rules matching inside a nested App's root; `@scope` does
 * not block inheritance, so shell fonts and theme values still flow down.
 * There is no fallback mode, no feature detection and no per-MFE opt-out.
 */

import postcss, {
  type AtRule,
  type ChildNode,
  type Declaration,
  type Root,
  type Rule,
} from 'postcss'

import { createBuildError, listNames } from '../diagnostics.ts'

const SCOPE_ATTRIBUTE = 'data-mfe-scope'

export interface ScopedCssOptions {
  /** The definition id, or ids, this stylesheet is scoped to. */
  readonly scope: string | readonly string[]
  /** File name, for diagnostics. */
  readonly from?: string
}

/** At-rules whose body is scoped in place. */
const NESTABLE_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'starting-style'])

/** At-rules hoisted out of `@scope`, where they cannot live, and namespaced. */
const NAMESPACED_AT_RULES = new Set(['keyframes', '-webkit-keyframes', 'font-face'])

/** At-rules that are global by nature and have no scoped equivalent. */
const REJECTED_AT_RULES: ReadonlyMap<string, string> = new Map([
  [
    'import',
    'Resolve the import at build time instead: an @import from a container stylesheet fetches an unscoped sheet that the page-level cascade applies to everything.',
  ],
  [
    'charset',
    'Delete it. The bundler emits UTF-8, and a container stylesheet does not get to declare the document encoding.',
  ],
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

/**
 * Rewrites a stylesheet into scoped output. Exported on its own so it can be
 * unit tested without running a build.
 */
export function transformScopedCss(css: string, options: ScopedCssOptions): string {
  const file = options.from ?? '<stylesheet>'
  const scopes = typeof options.scope === 'string' ? [options.scope] : [...options.scope]

  if (scopes.length === 0) {
    throw createBuildError({
      file,
      operation: 'scope this stylesheet',
      expected: 'at least one definition id to scope to',
      observed: 'an empty scope list',
      declaredBy: 'The scoped CSS transform',
      repair:
        'Pass the ids of the definitions this container exports. They are the values the mount roots carry in their data-mfe-scope attribute.',
    })
  }

  const namespace = scopes.join('-')

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

  rejectUnsupportedAtRules(root, file, scopes)

  rewriteAnimationReferences(root, namespaceKeyframes(root, namespace), namespace)
  rewriteFontFamilyReferences(root, namespaceFontFaces(root, namespace, file), namespace)

  const globals = postcss.root()
  const scoped = postcss.root()

  for (const node of [...root.nodes]) {
    node.remove()
    const hoisted =
      node.type === 'atrule' &&
      (NAMESPACED_AT_RULES.has(node.name.toLowerCase()) || node.nodes === undefined)
    ;(hoisted ? globals : scoped).append(node)
  }

  rewriteSelectors(scoped, file, scopes)

  const start = scopes.map(scope => `[${SCOPE_ATTRIBUTE}="${scope}"]`).join(', ')
  const parts: string[] = []

  const globalCss = stringify(globals)
  if (globalCss !== '') parts.push(globalCss)

  const scopedCss = stringify(scoped)
  if (scopedCss !== '') {
    const indented = scopedCss
      .split('\n')
      .map(line => (line.trim() === '' ? line : `  ${line}`))
      .join('\n')
    parts.push(`@scope (${start}) to ([${SCOPE_ATTRIBUTE}]) {\n${indented}\n}`)
  }

  return parts.join('\n\n')
}

function rejectUnsupportedAtRules(root: Root, file: string, scopes: readonly string[]): void {
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

    // A registered custom property is global: two containers registering
    // `--brand` with different syntaxes would fight over the page. Requiring
    // the container's own id as a prefix makes that collision unwritable.
    if (name === 'property') {
      const property = atRule.params.trim()
      const allowed = scopes.map(scope => `--${scope}-`)
      if (allowed.some(prefix => property.startsWith(prefix))) return

      throw createBuildError({
        file,
        ...positionOf(atRule),
        operation: 'scope this stylesheet',
        expected: `a registered property named with this container's prefix (${listNames(allowed)})`,
        observed: `@property ${property}`,
        declaredBy: 'The scoped CSS transform',
        repair: `Rename it to ${allowed[0] ?? '--<id>-'}${property.replace(/^--/, '')}. @property registers the property for the whole page, so an unprefixed name would collide with another container's.`,
      })
    }

    if (NESTABLE_AT_RULES.has(name) || NAMESPACED_AT_RULES.has(name)) return

    throw createBuildError({
      file,
      ...positionOf(atRule),
      operation: 'scope this stylesheet',
      expected: `an at-rule the transform knows how to scope (${listNames([
        ...NESTABLE_AT_RULES,
        ...NAMESPACED_AT_RULES,
        'property',
      ])})`,
      observed: `@${atRule.name}`,
      declaredBy: 'The scoped CSS transform',
      repair:
        'Remove it, or move it to the shell stylesheet if it really has to be page-wide. The transform refuses at-rules it cannot prove are contained, rather than emitting them as page-wide globals.',
    })
  })
}

function namespacedName(name: string, namespace: string): string {
  return `${name}__${namespace}`
}

function namespaceKeyframes(root: Root, namespace: string): readonly string[] {
  const names: string[] = []

  root.walkAtRules(atRule => {
    if (!atRule.name.toLowerCase().endsWith('keyframes')) return
    const name = atRule.params.trim()
    if (name === '') return
    names.push(name)
    atRule.params = namespacedName(name, namespace)
  })

  return names
}

function namespaceFontFaces(root: Root, namespace: string, file: string): readonly string[] {
  const families: string[] = []

  root.walkAtRules(atRule => {
    if (atRule.name.toLowerCase() !== 'font-face') return

    let declaration: Declaration | undefined
    atRule.walkDecls(/^font-family$/i, decl => {
      declaration = decl
    })

    if (declaration === undefined) {
      throw createBuildError({
        file,
        ...positionOf(atRule),
        operation: 'namespace an @font-face rule',
        expected: 'a font-family declaration',
        observed: '@font-face without one',
        declaredBy: 'The scoped CSS transform',
        repair:
          'Give the face a family name. The build renames it so two containers shipping the same font cannot overwrite one another at page level.',
      })
    }

    const raw = declaration.value.trim()
    const quote = raw[0]
    const family =
      raw.length >= 2 && (quote === "'" || quote === '"') && raw.endsWith(quote)
        ? raw.slice(1, -1)
        : raw
    families.push(family)
    declaration.value = `'${namespacedName(family, namespace)}'`
  })

  return families
}

function rewriteAnimationReferences(
  root: Root,
  keyframes: readonly string[],
  namespace: string,
): void {
  if (keyframes.length === 0) return
  const renames = new Map(keyframes.map(name => [name, namespacedName(name, namespace)]))

  root.walkDecls(declaration => {
    const property = declaration.prop.toLowerCase()
    if (property !== 'animation' && property !== 'animation-name') return
    declaration.value = replaceTokens(declaration.value, renames)
  })
}

function rewriteFontFamilyReferences(
  root: Root,
  families: readonly string[],
  namespace: string,
): void {
  if (families.length === 0) return

  root.walkDecls(declaration => {
    const property = declaration.prop.toLowerCase()
    if (property !== 'font' && property !== 'font-family') return
    const parent = declaration.parent
    if (parent?.type === 'atrule' && (parent as AtRule).name.toLowerCase() === 'font-face') return

    let value = declaration.value
    for (const family of families) {
      const namespaced = namespacedName(family, namespace)
      value = value.split(`'${family}'`).join(`'${namespaced}'`)
      value = value.split(`"${family}"`).join(`'${namespaced}'`)
      value = replaceTokens(value, new Map([[family, namespaced]]))
    }
    declaration.value = value
  })
}

/** Replaces whole identifier tokens, leaving strings and other words alone. */
function replaceTokens(value: string, renames: ReadonlyMap<string, string>): string {
  return value.replace(/[A-Za-z_-][\w-]*/g, token => renames.get(token) ?? token)
}

function rewriteSelectors(root: Root, file: string, scopes: readonly string[]): void {
  root.walkRules(rule => {
    if (isInsideKeyframes(rule)) return
    rule.selector = splitSelectorList(rule.selector)
      .map(selector => rewriteSelector(selector, rule, file, scopes))
      .join(', ')
  })
}

function isInsideKeyframes(rule: Rule): boolean {
  let parent = rule.parent
  while (parent !== undefined && parent.type !== 'root') {
    if (parent.type === 'atrule' && (parent as AtRule).name.toLowerCase().endsWith('keyframes')) {
      return true
    }
    parent = parent.parent
  }
  return false
}

/**
 * A reset written against `:root`, `html` or `body` becomes `:scope`, so it
 * applies at the MFE root instead of the document. Anything else naming those
 * is a build error: inside `@scope` every selector is relative to the scope
 * root, so it would silently become dead CSS rather than a global.
 */
function rewriteSelector(
  selector: string,
  rule: Rule,
  file: string,
  scopes: readonly string[],
): string {
  const trimmed = selector.trim()
  const leading = LEADING_ROOT_PATTERN.exec(trimmed)
  const rewritten =
    leading === null ? trimmed : `:scope${trimmed.slice(leading[0].length)}`.trimEnd()

  const offender = GLOBAL_ROOT_PATTERN.exec(rewritten)
  if (offender !== null) {
    throw createBuildError({
      file,
      ...positionOf(rule),
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

/** Normalizes leading whitespace so moved nodes stringify predictably. */
function stringify(root: Root): string {
  root.each((node, index) => {
    node.raws.before = index === 0 ? '' : '\n'
  })
  root.raws.after = ''
  return root.toString().trim()
}
