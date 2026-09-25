/**
 * Reading a Widget's contract from syntax, because a host renders a catalogue before it fetches
 * any container (§16).
 */

import { readStaticSchema, type JsonObject } from '../config/zod-static.ts'
import { createBuildError } from '../diagnostics.ts'
import { findExportedExpression, resolveRelativeModule } from './local-modules.ts'
import type { ContainerSources } from './sources.ts'
import {
  calleeName,
  objectProperty,
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
  readonly inputSchema: SchemaBinding
  readonly outputSchema: SchemaBinding
  /** Top-level declarations copied from the entry, in source order. */
  readonly prelude: readonly string[]
  readonly imports: readonly ContractImport[]
}

interface WidgetContractReadResult {
  readonly outputNames: readonly string[]
  readonly inputNames: readonly string[]
  /** Absent, never empty: "takes nothing" and "could not be read" differ for a host (§16). */
  readonly inputSchema?: JsonObject
  /** Absent when the output names cannot be read; an unreadable payload alone is `{}`. */
  readonly outputSchema?: JsonObject
  readonly source: WidgetContractSource
}

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
  readonly sources: ContainerSources
  readonly state: CopyState
}

export function readWidgetContract(
  sourceFile: ts.SourceFile,
  entryFile: string,
  factory: Ctx['factory'],
  id: string,
  imports: ReadonlyMap<string, ImportedBinding>,
  topLevel: ReadonlyMap<string, ts.Expression>,
  sources: ContainerSources,
): WidgetContractReadResult {
  const state: CopyState = { prelude: new Map(), imports: new Map(), fileImports: new Set() }
  const context: Ctx = { sourceFile, entryFile, factory, id, imports, topLevel, sources, state }

  const inputs = readSchemaProperty(context, 'inputSchema')
  const outputs = readSchemaProperty(context, 'outputSchema')

  return {
    inputNames: readObjectKeys(inputs.expression),
    outputNames: readObjectKeys(outputs.expression),
    ...(() => {
      const inputSchema = readInputSchema(inputs, id)
      return inputSchema === undefined ? {} : { inputSchema }
    })(),
    ...(() => {
      const outputSchema = readOutputSchema(outputs, id)
      return outputSchema === undefined ? {} : { outputSchema }
    })(),
    source: {
      inputSchema: inputs.binding,
      outputSchema: outputs.binding,
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
      field: 'inputSchema',
      sourceFile: inputs.sourceFile,
    }).jsonSchema
    return schema['type'] === 'object' ? { title: `${id} inputs`, ...schema } : undefined
  } catch {
    return undefined
  }
}

/**
 * The same shape as the inputs, so a host compares an output's payload with another Widget's
 * inputs with one reader. Each payload is read on its own rather than the whole `z.object`, so one
 * the build cannot read is `{}`, which JSON Schema reads as "anything", instead of losing every
 * output's; the provider still validates it. No property is listed as required: every output may
 * never be emitted.
 */
function readOutputSchema(outputs: ResolvedSchema, id: string): JsonObject | undefined {
  const node = objectShapeLiteral(outputs.expression)
  if (node === undefined) return undefined

  const properties: Record<string, JsonObject> = {}
  for (const property of node.properties) {
    // A spread or a computed name hides which outputs exist; a partial list would claim a closed set.
    const name = propertyName(property)
    if (name === null) return undefined
    properties[name] = ts.isPropertyAssignment(property)
      ? readPayloadSchema(property.initializer, outputs.sourceFile, name)
      : {}
  }

  return { title: `${id} outputs`, type: 'object', properties, additionalProperties: false }
}

function readPayloadSchema(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  name: string,
): JsonObject {
  try {
    return readStaticSchema(expression, {
      file: sourceFile.fileName,
      field: `outputSchema.${name}`,
      sourceFile,
    }).jsonSchema
  } catch {
    return {}
  }
}

interface ResolvedSchema {
  readonly binding: SchemaBinding
  readonly expression: ts.Expression
  readonly sourceFile: ts.SourceFile
}

function readSchemaProperty(context: Ctx, field: 'inputSchema' | 'outputSchema'): ResolvedSchema {
  const { sourceFile, entryFile, id, imports, topLevel, sources } = context
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
        field === 'inputSchema'
          ? 'Add an inputSchema, for example inputSchema: z.object({ orderId: z.string() }). Use z.object({}) when the Widget takes none.'
          : 'Add an outputSchema, for example outputSchema: z.object({ acknowledged: z.object({}) }). Use z.object({}) when the Widget emits none.',
    })
  }

  const initializer = unwrapExpression(property.initializer)

  // A reference to a binding imported from another module: re-export it.
  if (ts.isIdentifier(initializer)) {
    const imported = imports.get(initializer.text)
    if (imported !== undefined) {
      const file = resolveRelativeModule(entryFile, imported.moduleSpecifier)
      if (file !== null && file !== entryFile) {
        const external = sources.parse(file)
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
          'Declare the schema as an exported top-level const in a module of this container, for example `export const inputSchema = z.object({ … })` in src/contracts/<widget>.ts, and import it here.',
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
function readObjectKeys(expression: ts.Expression): readonly string[] {
  const node = objectShapeLiteral(expression)
  return node === undefined ? [] : literalKeys(node)
}

/** The literal passed to `z.object(…)`, looking through `.strict()` and friends. */
function objectShapeLiteral(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  const node = unwrapExpression(expression)
  if (!ts.isCallExpression(node)) return undefined

  const callee = calleeName(node)
  if (callee !== null && (callee.endsWith('.object') || callee === 'object')) {
    const first = node.arguments[0]
    const shape = first === undefined ? undefined : unwrapExpression(first)
    return shape !== undefined && ts.isObjectLiteralExpression(shape) ? shape : undefined
  }
  // `z.object({ … }).strict()` and friends: look through the chain.
  return ts.isPropertyAccessExpression(node.expression)
    ? objectShapeLiteral(node.expression.expression)
    : undefined
}

function literalKeys(object: ts.ObjectLiteralExpression): readonly string[] {
  const keys: string[] = []
  for (const property of object.properties) {
    const name = propertyName(property)
    if (name !== null) keys.push(name)
  }
  return keys
}
