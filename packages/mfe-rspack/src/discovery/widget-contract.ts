/**
 * Reading a Widget's contract without evaluating it.
 *
 * Two things come out of this pass. The first is the set of input and event
 * names, which the build checks against the reserved props and the handler-prop
 * mapping. The second is a description of *where the schemas live*, because the
 * generated Widget contract entry point has to reach them without importing the
 * container entry — importing the entry would drag the App, its router and the
 * route tree into a module a consumer imports only for types.
 *
 * So a schema is either re-exported from the module it already lives in, or
 * copied verbatim from the entry along with whatever top-level declarations and
 * imports it refers to. Anything the build cannot classify is a build error
 * naming the identifier, rather than a generated module that fails to resolve.
 */

import { statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { createBuildError } from '../diagnostics.ts'
import {
  calleeName,
  collectImportedBindings,
  collectTopLevelBindings,
  objectProperty,
  parseSourceFile,
  positionOf,
  propertyName,
  ts,
  unwrapExpression,
  type ImportedBinding,
} from './ts-ast.ts'

/** How a Widget contract schema is reached from the generated contract entry. */
export type SchemaBinding =
  | {
      readonly kind: 'reexport'
      /** Absolute path of the module that already exports this schema. */
      readonly file: string
      readonly exported: string
    }
  | {
      readonly kind: 'inline'
      /** The expression's source text, copied verbatim from the entry. */
      readonly expression: string
    }

export interface ContractImportName {
  readonly imported: string
  readonly local: string
}

export interface ContractImport {
  /** A bare specifier, or an absolute file path for a relative import. */
  readonly module: string
  readonly isFile: boolean
  readonly names: readonly ContractImportName[]
}

/** Everything a generated Widget contract entry needs in order to stand alone. */
export interface WidgetContractSource {
  readonly inputs: SchemaBinding
  readonly events: SchemaBinding
  /** Top-level declarations copied from the entry, in source order. */
  readonly prelude: readonly string[]
  readonly imports: readonly ContractImport[]
}

export interface WidgetContractReadResult {
  readonly eventNames: readonly string[]
  readonly inputNames: readonly string[]
  readonly source: WidgetContractSource
}

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx'] as const

interface CopyState {
  /** Names already emitted into the prelude, in insertion order. */
  readonly prelude: Map<string, string>
  /** Imports the copied code needs, keyed by module specifier. */
  readonly imports: Map<string, Map<string, string>>
  readonly fileImports: Set<string>
}

export function readWidgetContract(
  sourceFile: ts.SourceFile,
  entryFile: string,
  factory: { readonly options: ts.ObjectLiteralExpression; readonly call: ts.CallExpression },
  id: string,
  imports: ReadonlyMap<string, ImportedBinding>,
  topLevel: ReadonlyMap<string, ts.Expression>,
): WidgetContractReadResult {
  const state: CopyState = { prelude: new Map(), imports: new Map(), fileImports: new Set() }

  const inputs = readSchemaProperty(sourceFile, entryFile, factory, id, 'inputs', imports, topLevel, state)
  const events = readSchemaProperty(sourceFile, entryFile, factory, id, 'events', imports, topLevel, state)

  return {
    inputNames: readObjectKeys(inputs.expression, inputs.sourceFile, 'inputs'),
    eventNames: readObjectKeys(events.expression, events.sourceFile, 'events'),
    source: {
      inputs: inputs.binding,
      events: events.binding,
      prelude: [...state.prelude.values()],
      imports: [...state.imports].map(([module, names]) => ({
        module,
        isFile: state.fileImports.has(module),
        names: [...names].map(([local, imported]) => ({ local, imported })),
      })),
    },
  }
}

interface ResolvedSchema {
  readonly binding: SchemaBinding
  readonly expression: ts.Expression
  readonly sourceFile: ts.SourceFile
}

function readSchemaProperty(
  sourceFile: ts.SourceFile,
  entryFile: string,
  factory: { readonly options: ts.ObjectLiteralExpression; readonly call: ts.CallExpression },
  id: string,
  field: 'inputs' | 'events',
  imports: ReadonlyMap<string, ImportedBinding>,
  topLevel: ReadonlyMap<string, ts.Expression>,
  state: CopyState,
): ResolvedSchema {
  const property = objectProperty(factory.options, field)
  if (property === undefined) {
    const { line, column } = positionOf(sourceFile, factory.call)
    throw createBuildError({
      code: 'contract/input-mismatch',
      file: entryFile,
      line,
      column,
      id,
      operation: `read the Widget contract field '${field}'`,
      expected: `an \`${field}\` schema`,
      observed: 'a Widget declared without one',
      declaredBy: 'The Widget contract',
      repair:
        field === 'inputs'
          ? "Add an inputs schema, for example inputs: z.object({ orderId: z.string() }). Use z.object({}) when the Widget takes none."
          : "Add an events map, for example events: { acknowledged: z.object({}) }. Use {} when the Widget emits none.",
    })
  }

  const initializer = unwrapExpression(property.initializer)

  // A reference to a binding imported from another module: re-export it.
  if (ts.isIdentifier(initializer)) {
    const imported = imports.get(initializer.text)
    if (imported !== undefined) {
      const file = resolveRelativeModule(entryFile, imported.moduleSpecifier)
      if (file !== null && file !== entryFile) {
        const external = parseSourceFile(file)
        const expression = findExportedExpression(external, imported.imported)
        if (expression !== null) {
          return {
            binding: { kind: 'reexport', file, exported: imported.imported },
            expression,
            sourceFile: external,
          }
        }
      }
      const { line, column } = positionOf(sourceFile, property)
      throw createBuildError({
        code: 'contract/input-mismatch',
        file: entryFile,
        line,
        column,
        id,
        operation: `read the Widget contract field '${field}'`,
        expected: 'a schema the build can read without running the module',
        observed: `an import of '${imported.imported}' from '${imported.moduleSpecifier}'`,
        declaredBy: 'Static discovery',
        repair:
          "Declare the schema as an exported top-level const in a module of this container, for example `export const inputs = z.object({ … })` in src/contracts/<widget>.ts, and import it here.",
      })
    }

    // A top-level const in the entry: copy it and whatever it refers to.
    const local = topLevel.get(initializer.text)
    if (local !== undefined) {
      copyIdentifier(sourceFile, entryFile, id, field, initializer.text, imports, topLevel, state)
      return {
        binding: { kind: 'inline', expression: initializer.text },
        expression: unwrapExpression(local),
        sourceFile,
      }
    }
  }

  // Written at the call site: copy the expression text.
  collectFreeIdentifiers(initializer).forEach(name => {
    copyIdentifier(sourceFile, entryFile, id, field, name, imports, topLevel, state)
  })

  return {
    binding: { kind: 'inline', expression: initializer.getText(sourceFile) },
    expression: initializer,
    sourceFile,
  }
}

/* -------------------------------------------------------------------------- */
/* Copying what an inline schema refers to                                     */
/* -------------------------------------------------------------------------- */

function copyIdentifier(
  sourceFile: ts.SourceFile,
  entryFile: string,
  id: string,
  field: string,
  name: string,
  imports: ReadonlyMap<string, ImportedBinding>,
  topLevel: ReadonlyMap<string, ts.Expression>,
  state: CopyState,
  seen: Set<string> = new Set(),
): void {
  if (state.prelude.has(name) || seen.has(name)) return
  seen.add(name)

  const imported = imports.get(name)
  if (imported !== undefined) {
    const file = resolveRelativeModule(entryFile, imported.moduleSpecifier)
    if (file === entryFile) {
      throw createBuildError({
        code: 'contract/input-mismatch',
        file: entryFile,
        id,
        operation: `build the standalone contract entry for '${field}'`,
        expected: 'a schema that does not reach back into the container entry',
        observed: `'${name}', imported from the entry module itself`,
        declaredBy: 'The Widget contract entry point',
        repair:
          'Move the schema into its own module. The contract entry is imported by consumers for types alone, so it must not pull in the App entry or its route tree.',
      })
    }
    const module = file ?? imported.moduleSpecifier
    const names = state.imports.get(module) ?? new Map<string, string>()
    names.set(name, imported.imported)
    state.imports.set(module, names)
    if (file !== null) state.fileImports.add(module)
    return
  }

  const declaration = topLevel.get(name)
  if (declaration === undefined) {
    throw createBuildError({
      code: 'contract/input-mismatch',
      file: entryFile,
      id,
      operation: `build the standalone contract entry for '${field}'`,
      expected: 'a schema built from imports and top-level declarations',
      observed: `'${name}', which is neither`,
      declaredBy: 'The Widget contract entry point',
      repair: `Declare '${name}' at the top level of the entry, or move the whole schema into its own module and import it. The contract entry copies the schema, so it can only copy declarations it can see.`,
    })
  }

  for (const referenced of collectFreeIdentifiers(unwrapExpression(declaration))) {
    copyIdentifier(sourceFile, entryFile, id, field, referenced, imports, topLevel, state, seen)
  }

  state.prelude.set(name, `const ${name} = ${unwrapExpression(declaration).getText(sourceFile)}`)
}

/**
 * Identifiers an expression refers to from outside itself.
 *
 * Property names, object keys and anything bound inside the expression — an
 * arrow parameter in a `.refine()` callback, for instance — are excluded, so
 * the result over-approximates nothing and the caller never reports a local as
 * an unresolvable reference.
 */
export function collectFreeIdentifiers(expression: ts.Expression): readonly string[] {
  const bound = new Set<string>()
  const used = new Set<string>()

  const collectBound = (node: ts.Node): void => {
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) bound.add(node.name.text)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) bound.add(node.name.text)
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) bound.add(node.name.text)
    node.forEachChild(collectBound)
  }
  collectBound(expression)

  const collectUsed = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return
    if (ts.isPropertyAccessExpression(node)) {
      collectUsed(node.expression)
      return
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) collectUsed(property.initializer)
        else if (ts.isShorthandPropertyAssignment(property)) used.add(property.name.text)
        else if (ts.isSpreadAssignment(property)) collectUsed(property.expression)
      }
      return
    }
    if (ts.isIdentifier(node)) {
      if (!bound.has(node.text)) used.add(node.text)
      return
    }
    node.forEachChild(collectUsed)
  }
  collectUsed(expression)

  return [...used]
}

/* -------------------------------------------------------------------------- */
/* Reading key names                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The declared field names of `z.object({ … })` or of an events map. Returns an
 * empty list when the shape is not a literal the build can read; the names are
 * used for validation, and inventing them would be worse than checking none.
 */
function readObjectKeys(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  field: 'inputs' | 'events',
): readonly string[] {
  const node = unwrapExpression(expression)

  if (ts.isObjectLiteralExpression(node)) return literalKeys(node)

  if (field === 'inputs' && ts.isCallExpression(node)) {
    const callee = calleeName(node)
    if (callee !== null && (callee.endsWith('.object') || callee === 'object')) {
      const first = node.arguments[0]
      if (first !== undefined && ts.isObjectLiteralExpression(unwrapExpression(first))) {
        return literalKeys(unwrapExpression(first) as ts.ObjectLiteralExpression)
      }
    }
    // `z.object({ … }).strict()` and friends: look through the chain.
    if (ts.isPropertyAccessExpression(node.expression)) {
      return readObjectKeys(node.expression.expression, sourceFile, field)
    }
  }

  return []
}

function literalKeys(object: ts.ObjectLiteralExpression): readonly string[] {
  const keys: string[] = []
  for (const property of object.properties) {
    const name = propertyName(property)
    if (name !== null) keys.push(name)
  }
  return keys
}

/* -------------------------------------------------------------------------- */
/* Module resolution                                                           */
/* -------------------------------------------------------------------------- */

/** Resolves a relative specifier to a file on disk, or `null` for a bare one. */
export function resolveRelativeModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null

  const base = resolve(dirname(fromFile), specifier)
  const candidates: string[] = [base]
  // `./schemas.js` is how a TypeScript ESM import spells `./schemas.ts`.
  if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`)
  for (const extension of MODULE_EXTENSIONS) candidates.push(`${base}${extension}`)
  for (const extension of MODULE_EXTENSIONS) candidates.push(resolve(base, `index${extension}`))

  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Not a file: try the next candidate.
    }
  }
  return null
}

/** The initialiser of an exported top-level binding in another module. */
function findExportedExpression(sourceFile: ts.SourceFile, name: string): ts.Expression | null {
  const topLevel = collectTopLevelBindings(sourceFile)
  const localImports = collectImportedBindings(sourceFile)

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      const exported = (ts.getModifiers(statement) ?? []).some(
        modifier => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
      if (!exported) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        if (declaration.name.text !== name) continue
        if (declaration.initializer === undefined) continue
        return unwrapExpression(declaration.initializer)
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
      if (!ts.isNamedExports(statement.exportClause)) continue
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== name) continue
        const local = (element.propertyName ?? element.name).text
        const expression = topLevel.get(local)
        if (expression !== undefined) return unwrapExpression(expression)
        if (localImports.has(local)) return null
      }
    }
  }

  return null
}
