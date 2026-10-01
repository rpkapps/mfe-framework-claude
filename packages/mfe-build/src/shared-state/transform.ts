import type { SharedStateRequirements } from '@company/mfe-core/shared-state'
import {
  collectImportedBindings,
  collectTopLevelBindings,
  propertyName,
  ts,
} from '../discovery/ts-ast.ts'

export function sharedStateExpression(
  options: ts.ObjectLiteralExpression,
): ts.Expression | undefined {
  const property = options.properties.find(
    candidate => propertyName(candidate) === 'sharedStateSchema',
  )
  if (!property) return undefined
  if (options.properties.some(ts.isSpreadAssignment))
    throw new Error(
      'shared-state/unsupported-schema: Put sharedStateSchema directly on definition options without spreads; the production declaration must be removable',
    )
  return ts.isPropertyAssignment(property)
    ? property.initializer
    : ts.isShorthandPropertyAssignment(property)
      ? property.name
      : undefined
}
/** An actual declaration transform, followed by pruning authoring-only bindings/imports. */
export function transformSharedStateSource(
  source: string,
  filename: string,
  requirements: Readonly<Record<string, SharedStateRequirements>>,
): string {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const imports = collectImportedBindings(file)
  const factories = new Set(
    [...imports]
      .filter(
        ([, binding]) =>
          ['createApp', 'createWidget'].includes(binding.imported) &&
          ['@company/mfe-react', '@company/mfe-angular'].includes(binding.moduleSpecifier),
      )
      .map(([local]) => local),
  )
  const candidates = new Set<string>()
  const local = collectTopLevelBindings(file)
  const collectCandidates = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && (imports.has(node.text) || local.has(node.text))) {
      if (candidates.has(node.text)) return
      candidates.add(node.text)
      const initializer = local.get(node.text)
      if (initializer) collectCandidates(initializer)
    }
    node.forEachChild(collectCandidates)
  }
  const result = ts.transform(file, [
    context => {
      const visit: ts.Visitor = node => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          factories.has(node.expression.text)
        ) {
          const options = node.arguments[0]
          if (options && ts.isObjectLiteralExpression(options)) {
            const schema = sharedStateExpression(options)
            if (schema) {
              collectCandidates(schema)
              const identity = options.properties.find(property => propertyName(property) === 'id')
              const id =
                identity &&
                ts.isPropertyAssignment(identity) &&
                ts.isStringLiteral(identity.initializer)
                  ? identity.initializer.text
                  : undefined
              const refs = id === undefined ? undefined : requirements[id]
              if (!refs) throw new Error(`shared-state/missing-contract: ${id ?? filename}`)
              const properties = options.properties.filter(
                property =>
                  propertyName(property) !== 'sharedStateSchema' &&
                  propertyName(property) !== 'sharedState',
              )
              properties.push(
                ts.factory.createPropertyAssignment('sharedState', jsonExpression(refs)),
              )
              return ts.factory.updateCallExpression(node, node.expression, node.typeArguments, [
                ts.factory.updateObjectLiteralExpression(options, properties),
                ...node.arguments.slice(1),
              ])
            }
          }
        }
        return ts.visitEachChild(node, visit, context)
      }
      return root => ts.visitNode(root, visit) as ts.SourceFile
    },
  ])
  let output = result.transformed[0]
  if (!output) throw new Error('Shared-state transform produced no source file')
  // Fixed point: deleting a schema declaration makes its helper declarations unreferenced too.
  for (let pass = 0; pass <= candidates.size; pass++) {
    const references = new Set<string>()
    const read = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) return
      if (ts.isIdentifier(node)) {
        const parent = node.parent
        if (
          parent &&
          ((ts.isVariableDeclaration(parent) && parent.name === node) ||
            (ts.isPropertyAssignment(parent) && parent.name === node) ||
            (ts.isPropertyAccessExpression(parent) && parent.name === node))
        )
          return
        references.add(node.text)
      }
      node.forEachChild(read)
    }
    output.forEachChild(read)
    let changed = false
    const statements = output.statements.flatMap(statement => {
      if (ts.isVariableStatement(statement)) {
        const declarations = statement.declarationList.declarations.filter(declaration => {
          const remove =
            ts.isIdentifier(declaration.name) &&
            candidates.has(declaration.name.text) &&
            !references.has(declaration.name.text)
          if (remove) changed = true
          return !remove
        })
        if (!declarations.length) return []
        return [
          ts.factory.updateVariableStatement(
            statement,
            statement.modifiers,
            ts.factory.updateVariableDeclarationList(statement.declarationList, declarations),
          ),
        ]
      }
      if (ts.isImportDeclaration(statement) && statement.importClause) {
        const clause = statement.importClause
        const remove = (name: string): boolean => candidates.has(name) && !references.has(name)
        const defaultName = clause.name && !remove(clause.name.text) ? clause.name : undefined
        let bindings = clause.namedBindings
        if (bindings && ts.isNamedImports(bindings)) {
          const elements = bindings.elements.filter(element => !remove(element.name.text))
          bindings = elements.length ? ts.factory.updateNamedImports(bindings, elements) : undefined
        } else if (bindings && ts.isNamespaceImport(bindings) && remove(bindings.name.text))
          bindings = undefined
        if (defaultName !== clause.name || bindings !== clause.namedBindings) changed = true
        if (!defaultName && !bindings) return []
        return [
          ts.factory.updateImportDeclaration(
            statement,
            statement.modifiers,
            ts.factory.updateImportClause(clause, clause.isTypeOnly, defaultName, bindings),
            statement.moduleSpecifier,
            statement.attributes,
          ),
        ]
      }
      return [statement]
    })
    output = ts.factory.updateSourceFile(output, statements)
    if (!changed) break
  }
  const printed = ts.createPrinter().printFile(output)
  result.dispose()
  return printed
}
function jsonExpression(value: unknown): ts.Expression {
  if (value === null) return ts.factory.createNull()
  if (typeof value === 'string') return ts.factory.createStringLiteral(value)
  if (typeof value === 'number') return ts.factory.createNumericLiteral(value)
  if (typeof value === 'boolean') return value ? ts.factory.createTrue() : ts.factory.createFalse()
  if (Array.isArray(value))
    return ts.factory.createArrayLiteralExpression(value.map(jsonExpression))
  return ts.factory.createObjectLiteralExpression(
    Object.entries(value as object).map(([key, child]) =>
      ts.factory.createPropertyAssignment(
        ts.factory.createStringLiteral(key),
        jsonExpression(child),
      ),
    ),
  )
}
