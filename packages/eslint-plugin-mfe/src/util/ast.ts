/** Narrow AST aliases derived from `Rule.Node`, because `estree` is not a direct dependency. */

import type { Rule } from 'eslint'

export type AnyNode = Rule.Node

export type NodeOfType<T extends AnyNode['type']> = Extract<AnyNode, { type: T }>

export type Identifier = NodeOfType<'Identifier'>
export type MemberExpression = NodeOfType<'MemberExpression'>
export type CallExpression = NodeOfType<'CallExpression'>

/** ESLint attaches `parent` to every node; the published types only say so for listener nodes. */
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

/** `null` when the property is computed from a value that is not a string literal (`obj[key]`). */
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

/** Strips wrappers with no runtime meaning: `window!.fetch` resolves like `window.fetch`. */
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
 * True when the identifier is used as a value rather than as a name: a property key, a member
 * property, a declaration name and an import binding say nothing about the global object.
 */
export function isValueReference(node: Identifier): boolean {
  const parent = node.parent
  // A TypeScript-only position (`typeof localStorage`) names a type, not the runtime global.
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
