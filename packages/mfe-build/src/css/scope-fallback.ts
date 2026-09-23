/**
 * The scoping recipe for a container with no design system plugin to scope it, which an
 * integration opts into: every rule is confined to the container's mount roots with CSS `@scope`,
 * and what `@scope` cannot contain is made unique instead.
 */

import type { AtRule, ChildNode, Container, Plugin, Root, Rule } from 'postcss'

import { createBuildError } from '../diagnostics.ts'
import type { ScopeOptions } from './scope.ts'

const PLUGIN_NAME = 'mfe-scope-fallback'

// Page-wide definitions rather than styles: meaningless inside `@scope`, so they stay outside it,
// and `@layer a, b;` only orders layers. The ones that name something are hoisted above the scoped
// rules, which keeps each run of rules in one `@scope` block.
const PRELUDE_AT_RULES = new Set(['charset', 'import', 'namespace', 'layer'])
const DEFINITION_AT_RULES = new Set([
  'property',
  'font-face',
  'counter-style',
  'font-feature-values',
  'font-palette-values',
  'page',
])

// Grouping rules are entered rather than wrapped, so a scoped run stays inside the layer or
// condition it was written in, and a definition nested in one is still left outside `@scope`.
const GROUPING_AT_RULES = new Set(['layer', 'media', 'supports'])

const KEYFRAMES_PATTERN = /^(?:-[a-z]+-)?keyframes$/i
const ANIMATION_PROPERTY = /^(?:-[a-z]+-)?animation(?:-name)?$/i

// The document's own elements belong to the shell, and a selector reaching them from inside a
// scope matches nothing; `:root` and `:host` mean the container's root and are rewritten.
const DOCUMENT_ELEMENT = /(^|[\s>+~(,])(html|body)(?=$|[\s>+~.#:[),])/i
const ROOT_PSEUDO = /:(?:root|host)(?![\w(-])/g

/** Takes the same options as a design system's plugin, so either can scope a container. */
export function scopeFallbackPlugin(options: ScopeOptions): Plugin {
  return {
    postcssPlugin: PLUGIN_NAME,
    Once(root, helpers) {
      renameKeyframes(root, options.keyframes.suffix)
      root.walkRules(rule => {
        rewriteSelectors(rule)
      })
      hoistDefinitions(root)
      const params = `(${options.scope}) to (${options.boundary})`
      scopeContainer(
        root,
        () => new helpers.AtRule({ name: 'scope', params, raws: { afterName: ' ', between: ' ' } }),
      )
    },
  }
}

/** Keyframes cannot be scoped, so the ones this stylesheet defines get a name no other has. */
function renameKeyframes(root: Root, suffix: string): void {
  const renamed = new Map<string, string>()
  root.walkAtRules(KEYFRAMES_PATTERN, rule => {
    const name = rule.params.trim()
    if (!/^-?[A-Za-z_][\w-]*$/.test(name)) return
    const unique = `${name}--${suffix}`
    renamed.set(name, unique)
    rule.params = unique
  })
  if (renamed.size === 0) return

  // Custom properties included: Tailwind declares `--animate-*` and the utilities read it back.
  root.walkDecls(declaration => {
    if (!ANIMATION_PROPERTY.test(declaration.prop) && !declaration.prop.startsWith('--')) return
    declaration.value = declaration.value
      .split(/([\s,]+)/)
      .map(token => renamed.get(token) ?? token)
      .join('')
  })
}

function rewriteSelectors(rule: Rule): void {
  const parent = rule.parent
  if (parent?.type === 'atrule' && KEYFRAMES_PATTERN.test((parent as AtRule).name)) return

  const selectors = rule.selectors.map(selector => {
    if (DOCUMENT_ELEMENT.test(selector)) throw documentSelectorError(rule, selector)
    return selector.replace(ROOT_PSEUDO, ':scope')
  })
  // Reassigning re-joins the list, so an untouched rule keeps the author's formatting.
  if (selectors.some((selector, index) => selector !== rule.selectors[index])) {
    rule.selectors = [...new Set(selectors)]
  }
}

function documentSelectorError(rule: Rule, selector: string): Error {
  const start = rule.source?.start
  return createBuildError({
    file: rule.source?.input.file ?? '<stylesheet>',
    ...(start === undefined ? {} : { line: start.line, column: start.column }),
    operation: 'scope this container stylesheet',
    expected: "selectors that stay inside the container's mount roots",
    observed: `${selector.trim()}, which reaches the document`,
    declaredBy: 'The container stylesheet scope',
    repair:
      "Style the container's own elements instead. The shell owns html and body; to style the element the container mounts into, use :root, which becomes the scope root.",
  })
}

/** Moved after the leading `@charset`, `@import` and `@layer` statements, in their own order. */
function hoistDefinitions(root: Root): void {
  const nodes = root.nodes
  const definitions = nodes.filter(node => isDefinition(node))
  if (definitions.length === 0) return

  let anchor: ChildNode | undefined
  for (const node of nodes) {
    if (node.type === 'comment' || isPrelude(node)) {
      anchor = node
      continue
    }
    break
  }

  for (const definition of definitions) definition.remove()
  if (anchor === undefined) root.prepend(...definitions)
  else root.insertAfter(anchor, definitions)
}

/** Wraps each run of scopable nodes in one `@scope`, recursing into grouping rules. */
function scopeContainer(container: Root | AtRule, createScope: () => AtRule): void {
  let run: ChildNode[] = []

  const flush = (): void => {
    const nodes = run
    run = []
    // A run of comments alone has nothing to scope.
    if (!nodes.some(node => node.type !== 'comment')) return
    const scope = createScope()
    container.insertBefore(nodes[0] as ChildNode, scope)
    // Indentation is re-derived for the new depth; what sits between a selector and its brace
    // is kept, since the stylesheet's own `@layer a, b;` statements would otherwise set it.
    for (const node of nodes) {
      node.remove()
      node.cleanRaws(true)
    }
    scope.append(nodes)
  }

  for (const node of [...(container.nodes ?? [])]) {
    if (isPrelude(node) || isDefinition(node)) {
      flush()
      continue
    }
    if (isGrouping(node)) {
      flush()
      scopeContainer(node, createScope)
      continue
    }
    run.push(node)
  }
  flush()
}

function isAtRule(node: ChildNode, names: ReadonlySet<string>): node is AtRule {
  return node.type === 'atrule' && names.has(node.name.toLowerCase())
}

/** `@keyframes` in any vendor spelling, and the other page-wide definitions. */
function isDefinition(node: ChildNode): node is AtRule {
  if (node.type !== 'atrule') return false
  return DEFINITION_AT_RULES.has(node.name.toLowerCase()) || KEYFRAMES_PATTERN.test(node.name)
}

/** `@layer a, b;` has no body; `@layer a { … }` is a grouping rule. */
function isPrelude(node: ChildNode): node is AtRule {
  return isAtRule(node, PRELUDE_AT_RULES) && node.nodes === undefined
}

function isGrouping(node: ChildNode): node is AtRule & Container {
  return isAtRule(node, GROUPING_AT_RULES) && node.nodes !== undefined
}
