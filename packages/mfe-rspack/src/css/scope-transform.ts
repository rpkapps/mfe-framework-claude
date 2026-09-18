/**
 * Native `@scope` output for a container's CSS.
 *
 * Every App and Widget mounts inside an element carrying `data-mfe-scope`, and
 * the build emits the container's rules as
 *
 * ```css
 * @scope ([data-mfe-scope="operations"]) to ([data-mfe-scope]) { … }
 * ```
 *
 * The lower boundary is the part that matters for nesting: without it a parent
 * App's rules would keep matching inside a nested App's root. `@scope` does not
 * block inheritance, so shell fonts, theme values and custom properties still
 * flow down into the MFE.
 *
 * Class tokens are never rewritten. Hashing them would break every selector an
 * author reads in devtools and every `data-testid`-adjacent convention built on
 * them; the scoping lives in the selector the build wraps around them.
 *
 * Three things cannot live inside `@scope` and are therefore namespaced instead
 * of being emitted as page-wide globals: `@keyframes`, `@font-face`, and the
 * `:root` / `html` / `body` selectors a reset uses, which are rewritten to
 * `:scope`. Anything else that is global by nature fails the build, because
 * silently dropping it or silently leaking it are both worse than saying so.
 *
 * There is no fallback mode, no feature detection and no per-MFE opt-out.
 */

import postcss, { type AtRule, type ChildNode, type Declaration, type Root, type Rule } from 'postcss'

import { createBuildError, listNames } from '../diagnostics.ts'

export const DEFAULT_SCOPE_ATTRIBUTE = 'data-mfe-scope'

export interface ScopedCssOptions {
  /** The definition id, or ids, this stylesheet is scoped to. */
  readonly scope: string | readonly string[]
  /** File name, for diagnostics. */
  readonly from?: string
  /** Defaults to `data-mfe-scope`. */
  readonly scopeAttribute?: string
  /** Suffix for namespaced keyframes and font families. Defaults to the ids. */
  readonly namespace?: string
}

export interface ScopedCssResult {
  readonly css: string
  /** Original keyframe names that were namespaced. */
  readonly keyframes: readonly string[]
  /** Original font families that were namespaced. */
  readonly fontFamilies: readonly string[]
}

/** At-rules whose body is scoped in place. */
const NESTABLE_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'starting-style'])

/** At-rules that are hoisted out of `@scope` and namespaced. */
const NAMESPACED_AT_RULES = new Set(['keyframes', '-webkit-keyframes', 'font-face'])

/** At-rules that are global by nature and have no scoped equivalent. */
const REJECTED_AT_RULES: ReadonlyMap<string, { readonly why: string; readonly repair: string }> =
  new Map([
    [
      'import',
      {
        why: 'a second stylesheet loaded into the page',
        repair:
          'Resolve the import at build time instead — `@import` from a container stylesheet fetches an unscoped sheet the page-level cascade applies to everything.',
      },
    ],
    [
      'charset',
      {
        why: 'a document-level declaration',
        repair:
          'Delete it. The bundler emits UTF-8, and a container stylesheet does not get to declare the document encoding.',
      },
    ],
    [
      'namespace',
      {
        why: 'a document-level declaration',
        repair: 'Delete it. XML namespaces apply to the whole document, not to one MFE.',
      },
    ],
    [
      'page',
      {
        why: 'page box styling, which belongs to the printed document',
        repair:
          'Move print page styling to the shell. An MFE cannot own the margins of a page it shares.',
      },
    ],
    [
      'counter-style',
      {
        why: 'a globally named counter style',
        repair:
          'Use a built-in list style, or ask the shell to register the counter style once for the page.',
      },
    ],
    [
      'font-feature-values',
      {
        why: 'a globally named font feature set',
        repair: 'Use the font feature properties directly in a scoped rule instead.',
      },
    ],
    [
      'scope',
      {
        why: 'a scope the build also owns',
        repair:
          'Remove it. The build wraps this stylesheet in the container scope already, and a nested @scope would fight the lower boundary that separates nested Apps.',
      },
    ],
  ])

/** Selectors that reach outside the MFE root. */
const GLOBAL_ROOT_SELECTORS = [':root', 'html', 'body', ':host'] as const
const GLOBAL_ROOT_PATTERN = /(^|[\s>+~,(])(:root|:host|html|body)(?![\w-])/

/**
 * Rewrites a stylesheet into scoped output.
 *
 * Exported on its own so it can be unit tested without running a build; the
 * loader the plugin installs is a thin wrapper around this function.
 */
export function transformScopedCss(css: string, options: ScopedCssOptions): ScopedCssResult {
  const file = options.from ?? '<stylesheet>'
  const scopes = typeof options.scope === 'string' ? [options.scope] : [...options.scope]
  const attribute = options.scopeAttribute ?? DEFAULT_SCOPE_ATTRIBUTE

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

  const namespace = options.namespace ?? scopes.join('-')

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

  const keyframes = namespaceKeyframes(root, namespace)
  const fontFamilies = namespaceFontFaces(root, namespace, file)
  rewriteAnimationReferences(root, keyframes, namespace)
  rewriteFontFamilyReferences(root, fontFamilies, namespace)

  const globals = postcss.root()
  const scoped = postcss.root()

  for (const node of [...root.nodes]) {
    node.remove()
    if (node.type === 'atrule' && NAMESPACED_AT_RULES.has(node.name.toLowerCase())) {
      globals.append(node)
      continue
    }
    if (node.type === 'atrule' && isStatementAtRule(node)) {
      globals.append(node)
      continue
    }
    scoped.append(node)
  }

  rewriteSelectors(scoped, file, scopes)

  const start = scopes.map(scope => `[${attribute}="${scope}"]`).join(', ')
  const parts: string[] = []

  const globalCss = stringify(globals)
  if (globalCss !== '') parts.push(globalCss)

  const scopedCss = stringify(scoped)
  if (scopedCss !== '') {
    parts.push(`@scope (${start}) to ([${attribute}]) {\n${indent(scopedCss)}\n}`)
  }

  return { css: parts.join('\n\n'), keyframes, fontFamilies }
}

/* -------------------------------------------------------------------------- */
/* At-rule validation                                                          */
/* -------------------------------------------------------------------------- */

function rejectUnsupportedAtRules(root: Root, file: string, scopes: readonly string[]): void {
  root.walkAtRules(atRule => {
    const name = atRule.name.toLowerCase()

    const rejection = REJECTED_AT_RULES.get(name)
    if (rejection !== undefined) {
      throw createBuildError({
        file,
        ...positionOf(atRule),
        operation: 'scope this stylesheet',
        expected: 'CSS the container scope can contain',
        observed: `@${atRule.name}, which is ${rejection.why}`,
        declaredBy: 'The scoped CSS transform',
        repair: rejection.repair,
      })
    }

    if (name === 'property') {
      assertNamespacedProperty(atRule, file, scopes)
      return
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

/**
 * A registered custom property is global: two containers registering `--brand`
 * with different syntaxes would fight over the page. Requiring the container's
 * own id as a prefix makes the collision impossible to write.
 */
function assertNamespacedProperty(atRule: AtRule, file: string, scopes: readonly string[]): void {
  const name = atRule.params.trim()
  const allowed = scopes.map(scope => `--${scope}-`)
  if (allowed.some(prefix => name.startsWith(prefix))) return

  throw createBuildError({
    file,
    ...positionOf(atRule),
    operation: 'scope this stylesheet',
    expected: `a registered property named with this container's prefix (${listNames(allowed)})`,
    observed: `@property ${name}`,
    declaredBy: 'The scoped CSS transform',
    repair: `Rename it to ${allowed[0] ?? '--<id>-'}${name.replace(/^--/, '')}. @property registers the property for the whole page, so an unprefixed name would collide with another container's.`,
  })
}

/** `@layer a, b;` and other bodiless at-rules pass through unchanged. */
function isStatementAtRule(atRule: AtRule): boolean {
  return atRule.nodes === undefined
}

/* -------------------------------------------------------------------------- */
/* Namespacing                                                                 */
/* -------------------------------------------------------------------------- */

function namespacedName(name: string, namespace: string): string {
  return `${name}__${namespace}`
}

function namespaceKeyframes(root: Root, namespace: string): readonly string[] {
  const names: string[] = []

  root.walkAtRules(atRule => {
    if (!NAMESPACED_AT_RULES.has(atRule.name.toLowerCase())) return
    if (atRule.name.toLowerCase() === 'font-face') return
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

    const family = unquote(declaration.value.trim())
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
    if (declaration.parent?.type === 'atrule') {
      const parent = declaration.parent as AtRule
      if (parent.name.toLowerCase() === 'font-face') return
    }
    let value = declaration.value
    for (const family of families) {
      const replacement = `'${namespacedName(family, namespace)}'`
      value = value
        .split(`'${family}'`)
        .join(replacement)
        .split(`"${family}"`)
        .join(replacement)
      value = replaceTokens(value, new Map([[family, namespacedName(family, namespace)]]))
    }
    declaration.value = value
  })
}

/** Replaces whole identifier tokens, leaving strings and other words alone. */
function replaceTokens(value: string, renames: ReadonlyMap<string, string>): string {
  return value.replace(/[A-Za-z_-][\w-]*/g, token => renames.get(token) ?? token)
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === "'" || first === '"') && first === last) return value.slice(1, -1)
  }
  return value
}

/* -------------------------------------------------------------------------- */
/* Selectors                                                                   */
/* -------------------------------------------------------------------------- */

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

function rewriteSelector(
  selector: string,
  rule: Rule,
  file: string,
  scopes: readonly string[],
): string {
  const trimmed = selector.trim()
  if (trimmed === '') return trimmed

  const compounds = splitCompounds(trimmed)
  const rewritten: string[] = []

  for (let index = 0; index < compounds.length; index += 1) {
    const compound = compounds[index] ?? ''
    if (isCombinator(compound)) {
      rewritten.push(compound)
      continue
    }

    const isRootSelector = (GLOBAL_ROOT_SELECTORS as readonly string[]).includes(compound)
    if (isRootSelector) {
      if (index !== 0 || compound === ':host') {
        throw unscopableSelector(trimmed, compound, rule, file, scopes)
      }
      rewritten.push(':scope')
      continue
    }

    if (GLOBAL_ROOT_PATTERN.test(compound)) {
      throw unscopableSelector(trimmed, compound, rule, file, scopes)
    }

    rewritten.push(compound)
  }

  return joinCompounds(rewritten)
}

function unscopableSelector(
  selector: string,
  compound: string,
  rule: Rule,
  file: string,
  scopes: readonly string[],
): Error {
  const scope = scopes[0] ?? 'your-app'
  return createBuildError({
    file,
    ...positionOf(rule),
    operation: 'scope this stylesheet',
    expected: 'a selector contained by the MFE root',
    observed: `'${selector}', whose '${compound}' reaches the document`,
    declaredBy: 'The scoped CSS transform',
    repair: `Write it against the MFE root instead, for example \`:scope[data-theme="dark"] .card\`. Inside @scope every selector is relative to [data-mfe-scope="${scope}"], so '${compound}' would never match and the rule would be dead CSS rather than a global.`,
  })
}

/** Splits a selector list on top-level commas. */
export function splitSelectorList(selector: string): readonly string[] {
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

/** Splits one selector into compounds and the combinators between them. */
function splitCompounds(selector: string): readonly string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''

  const push = (): void => {
    if (current.trim() !== '') parts.push(current.trim())
    current = ''
  }

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index] ?? ''
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

    if (depth === 0 && (character === '>' || character === '+' || character === '~')) {
      push()
      parts.push(character)
      continue
    }
    if (depth === 0 && /\s/.test(character)) {
      push()
      parts.push(' ')
      continue
    }
    current += character
  }
  push()

  return collapseCombinators(parts)
}

function collapseCombinators(parts: readonly string[]): readonly string[] {
  const result: string[] = []
  for (const part of parts) {
    if (part === ' ' && (result.length === 0 || isCombinator(result[result.length - 1] ?? ''))) {
      continue
    }
    result.push(part)
  }
  while (result.length > 0 && isCombinator(result[result.length - 1] ?? '')) result.pop()
  return result
}

function isCombinator(part: string): boolean {
  return part === '>' || part === '+' || part === '~' || part === ' '
}

function joinCompounds(parts: readonly string[]): string {
  let output = ''
  for (const part of parts) {
    if (part === ' ') {
      output += ' '
      continue
    }
    if (isCombinator(part)) {
      output = `${output.trimEnd()} ${part} `
      continue
    }
    output += part
  }
  return output.trim()
}

/* -------------------------------------------------------------------------- */
/* Output                                                                      */
/* -------------------------------------------------------------------------- */

function positionOf(node: ChildNode): { readonly line?: number; readonly column?: number } {
  const start = node.source?.start
  if (start === undefined) return {}
  return { line: start.line, column: start.column }
}

function stringify(root: Root): string {
  root.each((node, index) => {
    node.raws.before = index === 0 ? '' : '\n'
  })
  root.raws.after = ''
  return root.toString().trim()
}

function indent(css: string): string {
  return css
    .split('\n')
    .map(line => (line.trim() === '' ? line : `  ${line}`))
    .join('\n')
}
