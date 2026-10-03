/**
 * The runtime validates with the declared Zod schemas; the build only types the generated binding
 * from them. It copies the declaration, with the imports and top-level constants it uses, into a
 * module the binding imports for its types alone, so TypeScript infers exactly what Zod parses and
 * nothing here interprets a schema.
 */
import { dirname, resolve } from 'node:path'

import { banner, quote, relativeSpecifier } from '../generate/emit.ts'
import { propertyName, ts, unwrapExpression } from '../discovery/ts-ast.ts'

export interface UserContextSource {
  /** The `schema` and `reads` expressions as written. */
  readonly schema?: string
  readonly reads?: string
  /** Top-level constants they use, in dependency order. */
  readonly constants: readonly string[]
  readonly imports: readonly UserContextImport[]
}
interface UserContextImport {
  readonly local: string
  /** `default`, `*` or an exported name. */
  readonly imported: string
  /** An absolute path for a relative import, so the copy can import it from anywhere. */
  readonly from: string
  readonly relative: boolean
  readonly typeOnly: boolean
}

/** The `schema` or `reads` expression of an options object's inline `userContext`. */
export function userContextExpression(
  options: ts.ObjectLiteralExpression,
  name: 'schema' | 'reads' = 'schema',
  host = false,
): ts.Expression | undefined {
  const properties = options.properties.filter(
    candidate => propertyName(candidate) === 'userContext',
  )
  const property = properties[0]
  if (!property) return undefined
  if (
    properties.length !== 1 ||
    !ts.isPropertyAssignment(property) ||
    options.properties.slice(options.properties.indexOf(property) + 1).some(ts.isSpreadAssignment)
  )
    throw new Error(
      'user-context/invalid-declaration: Declare userContext once, directly on the options and after any spreads, so another object cannot override it',
    )
  const declaration = unwrapExpression(property.initializer)
  if (!ts.isObjectLiteralExpression(declaration))
    throw new Error(
      'user-context/invalid-declaration: userContext must be an inline { schema, reads } declaration',
    )
  const allowed = host ? ['schema', 'reads', 'adapter', 'onError'] : ['schema', 'reads']
  const seen = new Set<string>()
  for (const member of declaration.properties) {
    const key = propertyName(member)
    if (
      !key ||
      !allowed.includes(key) ||
      seen.has(key) ||
      (!ts.isPropertyAssignment(member) &&
        !ts.isShorthandPropertyAssignment(member) &&
        !(host && key === 'onError' && ts.isMethodDeclaration(member)))
    )
      throw new Error(
        'user-context/invalid-declaration: userContext accepts unique schema and reads declarations without spreads',
      )
    seen.add(key)
  }
  const member = declaration.properties.find(candidate => propertyName(candidate) === name)
  return member && ts.isPropertyAssignment(member)
    ? member.initializer
    : member && ts.isShorthandPropertyAssignment(member)
      ? member.name
      : undefined
}

/** What the generated declaration module copies out of the authoring file. */
export function readUserContextSource(
  file: ts.SourceFile,
  schema: ts.Expression | undefined,
  reads: ts.Expression | undefined,
): UserContextSource {
  const imports = importsOf(file)
  const constants = new Map<string, ts.VariableDeclaration>()
  for (const statement of file.statements)
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          constants.set(declaration.name.text, declaration)
  const used = new Map<string, UserContextImport>()
  const copied: string[] = []
  const visited = new Set<string>()
  const text = (node: ts.Node): string => file.text.slice(node.getStart(file), node.end)
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isReference(node) && !visited.has(node.text)) {
      visited.add(node.text)
      const constant = constants.get(node.text)
      const imported = imports.get(node.text)
      if (constant) {
        constant.forEachChild(visit)
        copied.push(`const ${text(constant)}`)
      } else if (imported) used.set(node.text, imported)
    }
    node.forEachChild(visit)
  }
  if (schema) visit(schema)
  if (reads) visit(reads)
  return {
    ...(schema ? { schema: text(schema) } : {}),
    ...(reads ? { reads: text(reads) } : {}),
    constants: copied,
    imports: [...used.values()],
  }
}

/** Imported only for its type, so nothing it copies reaches a bundle. */
export function userContextDeclarationModule(
  source: UserContextSource,
  path: string,
  generator: string,
): string {
  const imports = source.imports.map(binding => {
    const from = quote(binding.relative ? relativeSpecifier(path, binding.from) : binding.from)
    const type = binding.typeOnly ? 'type ' : ''
    if (binding.imported === '*') return `import ${type}* as ${binding.local} from ${from}`
    if (binding.imported === 'default') return `import ${type}${binding.local} from ${from}`
    const name =
      binding.imported === binding.local ? binding.local : `${binding.imported} as ${binding.local}`
    return `import ${type}{ ${name} } from ${from}`
  })
  const members = [
    ...(source.schema === undefined ? [] : [`schema: ${source.schema}`]),
    ...(source.reads === undefined ? [] : [`reads: ${source.reads}`]),
  ]
  return [
    banner(generator),
    '// Copied from the userContext declaration so the binding can infer its types.',
    ...imports,
    ...source.constants,
    `export const declaration = { ${members.join(', ')} }`,
    '',
  ].join('\n')
}

function importsOf(file: ts.SourceFile): ReadonlyMap<string, UserContextImport> {
  const imports = new Map<string, UserContextImport>()
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue
    const clause = statement.importClause
    if (!clause) continue
    const specifier = statement.moduleSpecifier.text
    const relative = specifier.startsWith('.')
    const add = (local: string, imported: string, typeOnly: boolean): void => {
      imports.set(local, {
        local,
        imported,
        from: relative ? resolve(dirname(file.fileName), specifier) : specifier,
        relative,
        typeOnly: clause.isTypeOnly || typeOnly,
      })
    }
    if (clause.name) add(clause.name.text, 'default', false)
    const named = clause.namedBindings
    if (named && ts.isNamespaceImport(named)) add(named.name.text, '*', false)
    else if (named)
      for (const element of named.elements)
        add(element.name.text, (element.propertyName ?? element.name).text, element.isTypeOnly)
  }
  return imports
}

/** A name read as a value or type, not a property key or member being accessed. */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent
  return !(
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isQualifiedName(parent) && parent.right === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node)
  )
}
