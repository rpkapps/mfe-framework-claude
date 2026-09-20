/** Syntax only: one `SourceFile` per entry, no program, no type checker, no module evaluation. */

import { readFileSync } from 'node:fs'
import ts from 'typescript'

export { ts }

/** Parses one file into a standalone syntax tree, with JSX always enabled. */
export function parseSourceFile(file: string, text?: string): ts.SourceFile {
  const contents = text ?? readFileSync(file, 'utf8')
  return ts.createSourceFile(file, contents, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
}

interface SourcePosition {
  readonly line: number
  readonly column: number
}

/** One-based line and column, the way an editor reports them. */
export function positionOf(sourceFile: ts.SourceFile, node: ts.Node): SourcePosition {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { line: line + 1, column: character + 1 }
}

/** The source text of a node, collapsed and truncated for a diagnostic. */
export function describeNode(sourceFile: ts.SourceFile, node: ts.Node): string {
  const text = node.getText(sourceFile).replace(/\s+/g, ' ').trim()
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

/** The value of a plain string literal, or `null` for anything computed. */
export function stringLiteralValue(node: ts.Node | undefined): string | null {
  if (node === undefined) return null
  if (ts.isStringLiteralLike(node) && !ts.isTemplateExpression(node)) return node.text
  return null
}

/** The declared name of an object-literal property, or `null` when computed. */
export function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  const name = property.name
  if (name === undefined) return null
  if (ts.isIdentifier(name)) return name.text
  if (ts.isStringLiteral(name)) return name.text
  return null
}

/** Looks up one property of an object literal by name. */
export function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    if (propertyName(property) === name) return property
  }
  return undefined
}

export interface ImportedBinding {
  /** The name the module exports. */
  readonly imported: string
  /** The module the binding came from. */
  readonly moduleSpecifier: string
}

/** Keyed by local name, so `import { createWidget as make }` is recognised. */
export function collectImportedBindings(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ImportedBinding> {
  const bindings = new Map<string, ImportedBinding>()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (statement.importClause?.isTypeOnly === true) continue
    const moduleSpecifier = stringLiteralValue(statement.moduleSpecifier)
    if (moduleSpecifier === null) continue

    const clause = statement.importClause
    if (clause === undefined) continue

    if (clause.name !== undefined) {
      bindings.set(clause.name.text, { imported: 'default', moduleSpecifier })
    }

    const named = clause.namedBindings
    if (named === undefined) continue
    if (ts.isNamespaceImport(named)) {
      bindings.set(named.name.text, { imported: '*', moduleSpecifier })
      continue
    }
    for (const element of named.elements) {
      if (element.isTypeOnly) continue
      bindings.set(element.name.text, {
        imported: (element.propertyName ?? element.name).text,
        moduleSpecifier,
      })
    }
  }

  return bindings
}

/** Top-level `const`/`let` initialisers, keyed by the declared name. */
export function collectTopLevelBindings(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ts.Expression> {
  const bindings = new Map<string, ts.Expression>()

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      if (declaration.initializer === undefined) continue
      bindings.set(declaration.name.text, declaration.initializer)
    }
  }

  return bindings
}

/** Unwraps parentheses, `as`, `satisfies` and `!` to the shape underneath. */
export function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression
      continue
    }
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression
      continue
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression
      continue
    }
    return current
  }
}

/** The dotted callee: `createWidget` or `z.string`, else `null`. */
export function calleeName(node: ts.CallExpression): string | null {
  const parts: string[] = []
  let current: ts.Expression = unwrapExpression(node.expression)

  for (;;) {
    if (ts.isIdentifier(current)) {
      parts.unshift(current.text)
      return parts.join('.')
    }
    if (ts.isPropertyAccessExpression(current)) {
      parts.unshift(current.name.text)
      current = unwrapExpression(current.expression)
      continue
    }
    return null
  }
}

/** Walks every node of a file, depth first. */
export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  node.forEachChild(child => {
    walk(child, visit)
  })
}
