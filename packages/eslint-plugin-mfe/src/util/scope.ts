/**
 * Lexical resolution helpers: every rule asks the scope manager which binding a name is, because
 * bare name matching cannot tell `window.fetch` from a local `const window = ...`.
 */

import type { Scope, SourceCode } from 'eslint'
import type { AnyNode, MemberExpression } from './ast.ts'
import { asNode, staticPropertyName, unwrapExpression } from './ast.ts'

const GLOBAL_OBJECT_NAMES: ReadonlySet<string> = new Set(['window', 'globalThis', 'self', 'global'])

/** `null` when nothing declares the name, which in a browser realm means a global. */
function lookup(
  scope: Scope.Scope | null,
  name: string,
): { readonly variable: Scope.Variable; readonly scope: Scope.Scope } | null {
  for (let current = scope; current !== null; current = current.upper) {
    const variable = current.set.get(name)
    if (variable !== undefined) return { variable, scope: current }
  }
  return null
}

/** A local, parameter, import or module-level declaration of the same name shadows the global. */
export function isGlobalBinding(sourceCode: SourceCode, node: AnyNode, name: string): boolean {
  const found = lookup(sourceCode.getScope(node), name)
  if (found === null) return true
  if (found.scope.type !== 'global') return false
  // An implicit global — created by assigning to an undeclared name — is still the shared global.
  return found.variable.defs.every(def => def.type === 'ImplicitGlobalVariable')
}

export function isGlobalObjectName(sourceCode: SourceCode, node: AnyNode, name: string): boolean {
  return GLOBAL_OBJECT_NAMES.has(name) && isGlobalBinding(sourceCode, node, name)
}

/**
 * The canonical name of the global object an expression denotes: `window` becomes `globalThis`,
 * `globalThis.document` becomes `document`, and a shadowed `history` becomes `null`.
 */
export function resolveGlobalObject(
  sourceCode: SourceCode,
  expression: AnyNode,
  knownGlobals: ReadonlySet<string>,
): string | null {
  const node = unwrapExpression(expression)
  if (node.type === 'Identifier') {
    if (isGlobalObjectName(sourceCode, node, node.name)) return 'globalThis'
    if (knownGlobals.has(node.name) && isGlobalBinding(sourceCode, node, node.name)) {
      return node.name
    }
    return null
  }
  if (node.type === 'MemberExpression') {
    const property = staticPropertyName(node)
    if (property === null || !knownGlobals.has(property)) return null
    const object = resolveGlobalObject(sourceCode, asNode(node.object), knownGlobals)
    return object === 'globalThis' ? property : null
  }
  return null
}

export interface ImportedBinding {
  readonly source: string
  /** `default`, `*`, or the name as exported — never the local alias. */
  readonly imported: string
}

const ALIAS_DEPTH_LIMIT = 8

/**
 * Follows local aliases and namespace members back to the import, and answers `null` for anything
 * locally declared, so a local `function createWidget() {}` shadows the export.
 */
export function resolveImportedBinding(
  sourceCode: SourceCode,
  node: AnyNode,
  name: string,
  depth = 0,
): ImportedBinding | null {
  if (depth > ALIAS_DEPTH_LIMIT) return null
  const found = lookup(sourceCode.getScope(node), name)
  if (found === null) return null

  for (const def of found.variable.defs) {
    if (def.type === 'ImportBinding') {
      const source = def.parent.source.value
      if (typeof source !== 'string') return null
      if (def.node.type === 'ImportDefaultSpecifier') return { source, imported: 'default' }
      if (def.node.type === 'ImportNamespaceSpecifier') return { source, imported: '*' }
      const imported: { type: string; name?: string; value?: unknown } = def.node.imported
      if (imported.type === 'Identifier' && typeof imported.name === 'string') {
        return { source, imported: imported.name }
      }
      if (typeof imported.value === 'string') return { source, imported: imported.value }
      return null
    }

    if (def.type === 'Variable') {
      const init = def.node.init
      if (init === null || init === undefined) continue
      if (init.type === 'Identifier') {
        return resolveImportedBinding(sourceCode, asNode(def.node), init.name, depth + 1)
      }
      if (init.type === 'MemberExpression') {
        const resolved = resolveMemberBinding(
          sourceCode,
          asNode(init) as MemberExpression,
          depth + 1,
        )
        if (resolved !== null) return resolved
      }
    }
  }
  return null
}

/** `import * as mfe ...; mfe.createWidget()` resolves like a named import. */
export function resolveMemberBinding(
  sourceCode: SourceCode,
  node: MemberExpression,
  depth = 0,
): ImportedBinding | null {
  const property = staticPropertyName(node)
  if (property === null) return null
  const object = node.object
  if (object.type !== 'Identifier') return null
  const binding = resolveImportedBinding(sourceCode, node, object.name, depth)
  if (binding === null || binding.imported !== '*') return null
  return { source: binding.source, imported: property }
}

/** The import a callee comes from: `createWidget()`, `mk()`, `mfe.createWidget()`. */
export function resolveCalleeBinding(
  sourceCode: SourceCode,
  callee: AnyNode,
): ImportedBinding | null {
  if (callee.type === 'Identifier') {
    return resolveImportedBinding(sourceCode, callee, callee.name)
  }
  if (callee.type === 'MemberExpression') {
    return resolveMemberBinding(sourceCode, callee)
  }
  return null
}
