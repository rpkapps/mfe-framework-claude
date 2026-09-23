/**
 * Reading a Widget's contract from syntax, because a host renders a catalogue before it fetches
 * any container (§16).
 */

import { statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { readStaticSchema, type JsonObject } from '../config/zod-static.ts'
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

interface WidgetContractReadResult {
  readonly eventNames: readonly string[]
  readonly inputNames: readonly string[]
  /** Absent, never empty: "takes nothing" and "could not be read" differ for a host (§16). */
  readonly inputSchema?: JsonObject
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

interface Ctx {
  readonly sourceFile: ts.SourceFile
  readonly entryFile: string
  readonly factory: {
    readonly options: ts.ObjectLiteralExpression
    readonly call: ts.CallExpression
  }
  readonly id: string
  readonly imports: ReadonlyMap<string, ImportedBinding>
  readonly topLevel: ReadonlyMap<string, ts.Expression>
  readonly state: CopyState
}

export function readWidgetContract(
  sourceFile: ts.SourceFile,
  entryFile: string,
  factory: Ctx['factory'],
  id: string,
  imports: ReadonlyMap<string, ImportedBinding>,
  topLevel: ReadonlyMap<string, ts.Expression>,
): WidgetContractReadResult {
  const state: CopyState = { prelude: new Map(), imports: new Map(), fileImports: new Set() }
  const context: Ctx = { sourceFile, entryFile, factory, id, imports, topLevel, state }

  const inputs = readSchemaProperty(context, 'inputs')
  const events = readSchemaProperty(context, 'events')

  return {
    inputNames: readObjectKeys(inputs.expression, inputs.sourceFile, 'inputs'),
    eventNames: readObjectKeys(events.expression, events.sourceFile, 'events'),
    ...(() => {
      const inputSchema = readInputSchema(inputs, id)
      return inputSchema === undefined ? {} : { inputSchema }
    })(),
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

/**
 * Unreadable is not a build failure here (§16): a Widget whose inputs cannot be described still
 * mounts and validates at its own boundary, so failing would make a correct schema unshippable.
 */
function readInputSchema(inputs: ResolvedSchema, id: string): JsonObject | undefined {
  try {
    const schema = readStaticSchema(inputs.expression, {
      file: inputs.sourceFile.fileName,
      field: 'inputs',
      sourceFile: inputs.sourceFile,
    }).jsonSchema
    return schema['type'] === 'object' ? { title: `${id} inputs`, ...schema } : undefined
  } catch {
    return undefined
  }
}

interface ResolvedSchema {
  readonly binding: SchemaBinding
  readonly expression: ts.Expression
  readonly sourceFile: ts.SourceFile
}

function readSchemaProperty(context: Ctx, field: 'inputs' | 'events'): ResolvedSchema {
  const { sourceFile, entryFile, id, imports, topLevel } = context
  const property = optionProperty(context.factory.options, field, topLevel)
  if (property === undefined) {
    const { line, column } = positionOf(sourceFile, context.factory.call)
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
          ? 'Add an inputs schema, for example inputs: z.object({ orderId: z.string() }). Use z.object({}) when the Widget takes none.'
          : 'Add an events map, for example events: { acknowledged: z.object({}) }. Use {} when the Widget emits none.',
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
          'Declare the schema as an exported top-level const in a module of this container, for example `export const inputs = z.object({ … })` in src/contracts/<widget>.ts, and import it here.',
      })
    }

    // A top-level const in the entry: copy it and whatever it refers to.
    const local = topLevel.get(initializer.text)
    if (local !== undefined) {
      copyIdentifier(context, field, initializer.text)
      return {
        binding: { kind: 'inline', expression: initializer.text },
        expression: unwrapExpression(local),
        sourceFile,
      }
    }
  }

  // Written at the call site: copy the expression text.
  for (const name of collectFreeIdentifiers(initializer)) copyIdentifier(context, field, name)

  return {
    binding: { kind: 'inline', expression: initializer.getText(sourceFile) },
    expression: initializer,
    sourceFile,
  }
}

/** A Widget's options may spread a contract object declared beside them, so both are resolved. */
function optionProperty(
  options: ts.ObjectLiteralExpression,
  field: string,
  topLevel: ReadonlyMap<string, ts.Expression>,
): ts.PropertyAssignment | undefined {
  const direct = objectProperty(options, field)
  if (direct !== undefined) return direct

  for (const property of [...options.properties].reverse()) {
    if (!ts.isSpreadAssignment(property)) continue
    const spread = unwrapExpression(property.expression)
    const target = ts.isIdentifier(spread) ? topLevel.get(spread.text) : spread
    if (target === undefined) continue
    const object = unwrapExpression(target)
    if (!ts.isObjectLiteralExpression(object)) continue
    const found = objectProperty(object, field)
    if (found !== undefined) return found
  }
  return undefined
}

function copyIdentifier(
  context: Ctx,
  field: string,
  name: string,
  seen: Set<string> = new Set(),
): void {
  const { entryFile, id, imports, topLevel, state } = context
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
    copyIdentifier(context, field, referenced, seen)
  }

  state.prelude.set(
    name,
    `const ${name} = ${unwrapExpression(declaration).getText(context.sourceFile)}`,
  )
}

/** Anything bound inside is excluded, so a local is never reported as an unresolvable reference. */
function collectFreeIdentifiers(expression: ts.Expression): readonly string[] {
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

/** Empty when the shape is not a literal the build can read: inventing names would be worse. */
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

/** Resolves a relative specifier to a file on disk, or `null` for a bare one. */
function resolveRelativeModule(fromFile: string, specifier: string): string | null {
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
