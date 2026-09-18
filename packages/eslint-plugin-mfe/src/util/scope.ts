/**
 * Lexical resolution helpers.
 *
 * Every rule in this plugin answers "which binding is this name?" through the
 * scope manager rather than by comparing identifier text. Bare name matching
 * cannot tell `window.fetch` from a local `const window = ...`, and it cannot
 * see `import { createWidget as mk }` at all; scope analysis sees both.
 */

import type { Scope, SourceCode } from 'eslint'
import type { AnyNode, Identifier, MemberExpression } from './ast.ts'
import { asNode, staticPropertyName, unwrapExpression } from './ast.ts'

/** Names that denote the global object in a browser or worker realm. */
export const GLOBAL_OBJECT_NAMES: ReadonlySet<string> = new Set([
  'window',
  'globalThis',
  'self',
  'global',
])

/**
 * Walks the scope chain outwards and returns the variable a name resolves to,
 * together with the scope that declares it, or `null` when nothing declares it
 * (an unresolved reference, which in a browser realm means a global).
 */
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

/**
 * True when `name`, as used at `node`, refers to a real global: either nothing
 * declares it, or the only declaration is a predefined global, which carries no
 * definition site. A local, parameter, import or module-level declaration of
 * the same name shadows the global and is not it.
 */
export function isGlobalBinding(sourceCode: SourceCode, node: AnyNode, name: string): boolean {
  const found = lookup(sourceCode.getScope(node), name)
  if (found === null) return true
  if (found.scope.type !== 'global') return false
  // A predefined global has no definition site; an implicit global is the one
  // the code under review just created by assigning to an undeclared name,
  // which is still the shared global object.
  return found.variable.defs.every(def => def.type === 'ImplicitGlobalVariable')
}

/** True when the name, used at `node`, is one of the global-object aliases. */
export function isGlobalObjectName(sourceCode: SourceCode, node: AnyNode, name: string): boolean {
  return GLOBAL_OBJECT_NAMES.has(name) && isGlobalBinding(sourceCode, node, name)
}

/** Convenience wrapper for an identifier reached through a listener. */
export function isGlobalObjectIdentifier(sourceCode: SourceCode, node: Identifier): boolean {
  return isGlobalObjectName(sourceCode, node, node.name)
}

/**
 * Resolves an expression expected to denote a global object, or one of its
 * well-known properties, and returns the canonical name of that object.
 *
 * `window` becomes `globalThis`, `globalThis.document` becomes `document`,
 * `window.history` becomes `history`, and a shadowed `history` becomes `null`.
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

/** A binding that originates from an `import` declaration. */
export interface ImportedBinding {
  /** The module specifier the binding comes from. */
  readonly source: string
  /**
   * The exported name: `default` for a default import, `*` for a namespace
   * import, otherwise the name as exported by the module, not the local alias.
   */
  readonly imported: string
}

const ALIAS_DEPTH_LIMIT = 8

/**
 * Resolves the name used at `node` back to the import it ultimately comes from,
 * following local aliases (`const mk = createWidget`) and namespace member
 * aliases (`const mk = mfe.createWidget`).
 *
 * Returns `null` for anything locally declared, which is what makes a local
 * `function createWidget() {}` shadow the framework export instead of being
 * mistaken for it.
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
      // `const mk = createWidget`
      if (init.type === 'Identifier') {
        return resolveImportedBinding(sourceCode, asNode(def.node), init.name, depth + 1)
      }
      // `const mk = mfe.createWidget`
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

/**
 * Resolves `namespace.member` where `namespace` is a namespace import, so that
 * `import * as mfe from '@company/mfe-react'; mfe.createWidget()` is recognised
 * as the same binding as a named import of `createWidget`.
 */
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

/**
 * Resolves the callee of a call expression to the import it comes from,
 * covering `createWidget()`, `mk()` (aliased import), `mfe.createWidget()`
 * (namespace import) and one level of local re-aliasing.
 */
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
