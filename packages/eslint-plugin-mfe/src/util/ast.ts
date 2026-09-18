/**
 * Narrow AST aliases derived from ESLint's own rule types.
 *
 * The `estree` types are not a direct dependency of this package, so every node
 * type used by a rule is extracted from `Rule.Node` instead of imported. That
 * keeps the rules typed without adding a dependency the runtime does not need.
 */

import type { Rule } from 'eslint'

export type AnyNode = Rule.Node

export type NodeOfType<T extends AnyNode['type']> = Extract<AnyNode, { type: T }>

export type Identifier = NodeOfType<'Identifier'>
export type MemberExpression = NodeOfType<'MemberExpression'>
export type CallExpression = NodeOfType<'CallExpression'>

/**
 * ESLint attaches `parent` to every node before a rule ever sees it, but the
 * published node types only say so for nodes reached through a listener. This
 * is that fact, spelled once, instead of an assertion at each use site.
 */
export function asNode(value: unknown): AnyNode {
  return value as AnyNode
}

/** Function-like nodes: everything that opens a new execution scope. */
const FUNCTION_TYPES: ReadonlySet<string> = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
])

export function isFunctionNode(node: { readonly type: string }): boolean {
  return FUNCTION_TYPES.has(node.type)
}

/**
 * The static property name of a member expression, or `null` when the property
 * is computed from a value that is not a string literal (`obj[key]`).
 */
export function staticPropertyName(node: MemberExpression): string | null {
  const property = node.property
  if (!node.computed && property.type === 'Identifier') return property.name
  if (node.computed && property.type === 'Literal' && typeof property.value === 'string') {
    return property.value
  }
  return null
}

const TS_EXPRESSION_WRAPPERS: ReadonlySet<string> = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSInstantiationExpression',
  'TSTypeAssertion',
])

/**
 * Strips the expression wrappers that carry no runtime meaning, so
 * `(window as Window).fetch` and `window!.fetch` resolve like `window.fetch`.
 */
export function unwrapExpression(node: AnyNode): AnyNode {
  let current: AnyNode = node
  for (let guard = 0; guard < 16; guard += 1) {
    if (!TS_EXPRESSION_WRAPPERS.has(current.type) && current.type !== 'ChainExpression') {
      return current
    }
    const inner: unknown = (current as { expression?: unknown }).expression
    if (inner === undefined || inner === null) return current
    current = asNode(inner)
  }
  return current
}

/**
 * True when the identifier is used as a value rather than as a name. A property
 * key, a member property, a declaration name or an import binding are all
 * spellings of the same word that say nothing about the global object.
 */
export function isValueReference(node: Identifier): boolean {
  const parent = node.parent
  // TypeScript-only positions (`typeof localStorage`, `declare const ...`) name
  // a type, not the global object at runtime.
  if (parent.type.startsWith('TS')) return TS_EXPRESSION_WRAPPERS.has(parent.type)
  switch (parent.type) {
    case 'MemberExpression':
      return parent.object === node || parent.computed
    case 'Property':
      return parent.value === node || parent.computed
    case 'PropertyDefinition':
      return parent.value === node || parent.computed
    case 'MethodDefinition':
      return parent.computed
    case 'VariableDeclarator':
      return parent.init === node
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ExportSpecifier':
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return false
    default:
      return true
  }
}
