import type { UserContextRequirements } from '@company/mfe-core/user-context'
import {
  collectImportedBindings,
  collectTopLevelBindings,
  propertyName,
  ts,
  unwrapExpression,
} from '../discovery/ts-ast.ts'

export function userContextExpression(
  options: ts.ObjectLiteralExpression,
  name: 'schema' | 'reads' = 'schema',
): ts.Expression | undefined {
  if (
    options.properties.some(property =>
      ['userContextSchema', 'userContextReads'].includes(propertyName(property) ?? ''),
    )
  )
    throw new Error(
      'user-context/unsupported-schema: Declare userContext: { schema, reads } on definition options',
    )
  const properties = options.properties.filter(
    candidate => propertyName(candidate) === 'userContext',
  )
  const property = properties[0]
  if (!property) return undefined
  if (
    properties.length !== 1 ||
    options.properties.some(ts.isSpreadAssignment) ||
    !ts.isPropertyAssignment(property)
  )
    throw new Error(
      'user-context/unsupported-schema: Put userContext directly on definition options once without spreads',
    )
  const declaration = unwrapExpression(property.initializer)
  if (!ts.isObjectLiteralExpression(declaration))
    throw new Error(
      'user-context/unsupported-schema: userContext must be an inline { schema, reads } declaration',
    )
  const seen = new Set<string>()
  for (const member of declaration.properties) {
    const key = propertyName(member)
    if (
      !key ||
      !['schema', 'reads'].includes(key) ||
      seen.has(key) ||
      (!ts.isPropertyAssignment(member) && !ts.isShorthandPropertyAssignment(member))
    )
      throw new Error(
        'user-context/unsupported-schema: userContext accepts unique schema and reads declarations without spreads',
      )
    seen.add(key)
  }
  if (!seen.size)
    throw new Error(
      'user-context/unsupported-schema: userContext needs a schema or reads declaration',
    )
  const member = declaration.properties.find(candidate => propertyName(candidate) === name)
  return member && ts.isPropertyAssignment(member)
    ? member.initializer
    : member && ts.isShorthandPropertyAssignment(member)
      ? member.name
      : undefined
}
/** An actual declaration transform, followed by pruning authoring-only bindings/imports. */
export function transformUserContextSource(
  source: string,
  filename: string,
  requirements: Readonly<Record<string, UserContextRequirements>>,
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
            const schema = userContextExpression(options)
            const reads = userContextExpression(options, 'reads')
            if (schema || reads) {
              if (schema) collectCandidates(schema)
              if (reads) collectCandidates(reads)
              const identity = options.properties.find(property => propertyName(property) === 'id')
              const id =
                identity &&
                ts.isPropertyAssignment(identity) &&
                ts.isStringLiteral(identity.initializer)
                  ? identity.initializer.text
                  : undefined
              const refs = id === undefined ? undefined : requirements[id]
              if (!refs) throw new Error(`user-context/missing-contract: ${id ?? filename}`)
              const properties = options.properties.filter(
                property =>
                  propertyName(property) !== 'userContext' &&
                  propertyName(property) !== '__userContext',
              )
              properties.push(
                ts.factory.createPropertyAssignment('__userContext', jsonExpression(refs)),
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
  if (!output) throw new Error('User-context transform produced no source file')
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
