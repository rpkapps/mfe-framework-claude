/**
 * Static discovery of the definitions a container exports.
 *
 * Everything here is read from syntax. A definition's id, kind and version are
 * whatever literals the author wrote in the designated entry module; no module
 * is evaluated and no render function is ever called, so reading metadata
 * cannot activate anything or mint an identity that differs between builds.
 *
 * Named exports are canonical. A default export is accepted only when the
 * container exports exactly one definition, because `./app` and
 * `./widgets/<id>` have to name something stable and "the default one" stops
 * being a name as soon as there are two.
 */

import {
  DEFINITION_ID_RULE,
  eventNameToHandlerProp,
  isReservedInputName,
  isValidDefinitionId,
  isValidEventName,
  RESERVED_INPUT_NAMES,
  type DefinitionKind,
} from '@company/mfe-core'

import { createBuildError, listNames } from '../diagnostics.ts'
import {
  readWidgetContract,
  type ContractImport,
  type ContractImportName,
  type SchemaBinding,
  type WidgetContractSource,
} from './widget-contract.ts'
import {
  calleeName,
  collectImportedBindings,
  collectTopLevelBindings,
  describeNode,
  objectProperty,
  parseSourceFile,
  positionOf,
  propertyName,
  stringLiteralValue,
  ts,
  unwrapExpression,
  walk,
  type ImportedBinding,
} from './ts-ast.ts'

/** The modules `createApp` and `createWidget` may be imported from. */
export const DEFAULT_DEFINITION_MODULES = ['@company/mfe-react'] as const

const FACTORY_KINDS: ReadonlyMap<string, DefinitionKind> = new Map([
  ['createApp', 'app'],
  ['createWidget', 'widget'],
])

export interface DiscoveredDefinition {
  readonly id: string
  readonly kind: DefinitionKind
  readonly version?: string
  /** The entry's export name; `'default'` for a default export. */
  readonly exportName: string
  readonly isDefaultExport: boolean
  /** Widget only. Contract event names, in declaration order. */
  readonly eventNames: readonly string[]
  /** Widget only. Input field names, when the schema could be read. */
  readonly inputNames: readonly string[]
  /** Widget only. How to reach the contract schemas without the App entry. */
  readonly contractSource?: WidgetContractSource
}

export type { ContractImport, ContractImportName, SchemaBinding, WidgetContractSource }

export interface DiscoveryResult {
  readonly entryFile: string
  readonly definitions: readonly DiscoveredDefinition[]
  readonly app: DiscoveredDefinition | undefined
  readonly widgets: readonly DiscoveredDefinition[]
}

export interface DiscoverDefinitionsOptions {
  /** Modules the definition factories may be imported from. */
  readonly definitionModules?: readonly string[]
  /** Pre-read entry source, so callers can discover without touching disk. */
  readonly entrySource?: string
}

interface ExportedBinding {
  readonly exportName: string
  readonly isDefaultExport: boolean
  readonly expression: ts.Expression
  readonly node: ts.Node
}

/**
 * Reads every definition the designated entry exports.
 *
 * Only `entryFile` is parsed for definitions. Modules the entry imports are
 * parsed at most one level deep, and only to read a Widget's contract schemas,
 * which is what lets a contract live in its own side-effect-free module.
 */
export function discoverDefinitions(
  entryFile: string,
  options: DiscoverDefinitionsOptions = {},
): DiscoveryResult {
  const sourceFile = parseSourceFile(entryFile, options.entrySource)
  const definitionModules = options.definitionModules ?? DEFAULT_DEFINITION_MODULES
  const imports = collectImportedBindings(sourceFile)
  const topLevel = collectTopLevelBindings(sourceFile)

  const factories = resolveFactoryNames(imports, definitionModules)
  assertEveryDefinitionIsExported(sourceFile, factories, topLevel)

  const definitions: DiscoveredDefinition[] = []
  for (const binding of collectExportedBindings(sourceFile, topLevel)) {
    const call = asFactoryCall(binding.expression, factories)
    if (call === null) continue
    definitions.push(readDefinition(sourceFile, entryFile, binding, call, imports, topLevel))
  }

  assertContainerShape(sourceFile, entryFile, definitions)

  const app = definitions.find(definition => definition.kind === 'app')
  return {
    entryFile,
    definitions,
    app,
    widgets: definitions.filter(definition => definition.kind === 'widget'),
  }
}

/* -------------------------------------------------------------------------- */
/* Factory resolution                                                          */
/* -------------------------------------------------------------------------- */

/** Local name to definition kind, for the factories this entry imported. */
function resolveFactoryNames(
  imports: ReadonlyMap<string, ImportedBinding>,
  definitionModules: readonly string[],
): ReadonlyMap<string, DefinitionKind> {
  const factories = new Map<string, DefinitionKind>()

  for (const [local, binding] of imports) {
    if (!definitionModules.includes(binding.moduleSpecifier)) continue
    const kind = FACTORY_KINDS.get(binding.imported)
    if (kind !== undefined) factories.set(local, kind)
  }

  return factories
}

interface FactoryCall {
  readonly kind: DefinitionKind
  readonly call: ts.CallExpression
  readonly options: ts.ObjectLiteralExpression
}

function asFactoryCall(
  expression: ts.Expression,
  factories: ReadonlyMap<string, DefinitionKind>,
): FactoryCall | null {
  const node = unwrapExpression(expression)
  if (!ts.isCallExpression(node)) return null
  const callee = calleeName(node)
  if (callee === null) return null
  const kind = factories.get(callee)
  if (kind === undefined) return null

  const first = node.arguments[0]
  if (first === undefined || !ts.isObjectLiteralExpression(unwrapExpression(first))) {
    return null
  }
  return { kind, call: node, options: unwrapExpression(first) as ts.ObjectLiteralExpression }
}

/* -------------------------------------------------------------------------- */
/* Exported bindings                                                           */
/* -------------------------------------------------------------------------- */

function collectExportedBindings(
  sourceFile: ts.SourceFile,
  topLevel: ReadonlyMap<string, ts.Expression>,
): readonly ExportedBinding[] {
  const bindings: ExportedBinding[] = []

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        if (declaration.initializer === undefined) continue
        bindings.push({
          exportName: declaration.name.text,
          isDefaultExport: false,
          expression: declaration.initializer,
          node: declaration,
        })
      }
      continue
    }

    if (ts.isExportAssignment(statement) && statement.isExportEquals !== true) {
      const expression = unwrapExpression(statement.expression)
      const resolved = ts.isIdentifier(expression)
        ? (topLevel.get(expression.text) ?? expression)
        : expression
      bindings.push({
        exportName: 'default',
        isDefaultExport: true,
        expression: resolved,
        node: statement,
      })
      continue
    }

    if (ts.isExportDeclaration(statement) && statement.isTypeOnly !== true) {
      const clause = statement.exportClause
      if (clause === undefined || !ts.isNamedExports(clause)) continue
      if (statement.moduleSpecifier !== undefined) continue
      for (const element of clause.elements) {
        if (element.isTypeOnly) continue
        const local = (element.propertyName ?? element.name).text
        const expression = topLevel.get(local)
        if (expression === undefined) continue
        const exportName = element.name.text
        bindings.push({
          exportName,
          isDefaultExport: exportName === 'default',
          expression,
          node: element,
        })
      }
    }
  }

  return bindings
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
  )
}

/**
 * A `createWidget` call the entry never exports is a definition the shell can
 * never load. It is almost always a forgotten `export`, so it is reported here
 * rather than silently producing a container with one definition fewer.
 */
function assertEveryDefinitionIsExported(
  sourceFile: ts.SourceFile,
  factories: ReadonlyMap<string, DefinitionKind>,
  topLevel: ReadonlyMap<string, ts.Expression>,
): void {
  const exportedExpressions = new Set(
    collectExportedBindings(sourceFile, topLevel).map(binding => unwrapExpression(binding.expression)),
  )

  walk(sourceFile, node => {
    if (!ts.isCallExpression(node)) return
    const callee = calleeName(node)
    if (callee === null || !factories.has(callee)) return
    if (exportedExpressions.has(node)) return

    const { line, column } = positionOf(sourceFile, node)
    throw createBuildError({
      code: 'registry/invalid-descriptor',
      file: sourceFile.fileName,
      line,
      column,
      operation: 'collect the definitions this container exports',
      expected: 'every definition in the entry module to be exported',
      observed: `${callee}(…) assigned to something the entry does not export`,
      declaredBy: 'Static discovery',
      repair:
        'Add `export` to the declaration. Only exported definitions become Module Federation entries, so an unexported one can never be mounted.',
    })
  })
}

/* -------------------------------------------------------------------------- */
/* Reading one definition                                                      */
/* -------------------------------------------------------------------------- */

function readDefinition(
  sourceFile: ts.SourceFile,
  entryFile: string,
  binding: ExportedBinding,
  factory: FactoryCall,
  imports: ReadonlyMap<string, ImportedBinding>,
  topLevel: ReadonlyMap<string, ts.Expression>,
): DiscoveredDefinition {
  const id = readIdentity(sourceFile, factory)
  const version = readVersion(sourceFile, factory, id)

  if (factory.kind === 'app') {
    return {
      id,
      kind: 'app',
      ...(version === undefined ? {} : { version }),
      exportName: binding.exportName,
      isDefaultExport: binding.isDefaultExport,
      eventNames: [],
      inputNames: [],
    }
  }

  const contract = readWidgetContract(sourceFile, entryFile, factory, id, imports, topLevel)

  return {
    id,
    kind: 'widget',
    ...(version === undefined ? {} : { version }),
    exportName: binding.exportName,
    isDefaultExport: binding.isDefaultExport,
    eventNames: contract.eventNames,
    inputNames: contract.inputNames,
    contractSource: contract.source,
  }
}

function readIdentity(sourceFile: ts.SourceFile, factory: FactoryCall): string {
  const property = objectProperty(factory.options, 'id')
  const { line, column } = positionOf(sourceFile, property ?? factory.call)

  if (property === undefined) {
    throw createBuildError({
      code: 'registry/invalid-descriptor',
      file: sourceFile.fileName,
      line,
      column,
      operation: 'read the definition id',
      expected: 'an `id` property',
      observed: 'a definition without one',
      declaredBy: 'Static discovery',
      repair: `Add an id, for example { id: 'order-row', … }. It must be ${DEFINITION_ID_RULE}.`,
    })
  }

  const value = stringLiteralValue(property.initializer)
  if (value === null) {
    throw createBuildError({
      code: 'registry/invalid-descriptor',
      file: sourceFile.fileName,
      line,
      column,
      operation: 'read the definition id',
      expected: 'a plain string literal',
      observed: describeNode(sourceFile, property.initializer),
      declaredBy: 'Static discovery',
      repair:
        'Write the id inline as a literal. The build reads it without running your code, so a computed id cannot be read and would also change between builds.',
    })
  }

  if (!isValidDefinitionId(value)) {
    throw createBuildError({
      code: 'registry/invalid-descriptor',
      file: sourceFile.fileName,
      line,
      column,
      id: value,
      operation: 'read the definition id',
      expected: DEFINITION_ID_RULE,
      observed: JSON.stringify(value),
      declaredBy: 'The framework identity rules',
      repair:
        'Rename the definition. Its id is also its storage prefix and its CSS scope value, so it has to be unambiguous in both.',
    })
  }

  return value
}

function readVersion(
  sourceFile: ts.SourceFile,
  factory: FactoryCall,
  id: string,
): string | undefined {
  const property = objectProperty(factory.options, 'version')
  if (property === undefined) return undefined

  const value = stringLiteralValue(property.initializer)
  if (value === null) {
    const { line, column } = positionOf(sourceFile, property)
    throw createBuildError({
      code: 'registry/invalid-descriptor',
      file: sourceFile.fileName,
      line,
      column,
      id,
      operation: 'read the definition version',
      expected: 'a plain string literal',
      observed: describeNode(sourceFile, property.initializer),
      declaredBy: 'Static discovery',
      repair:
        "Write the version inline, for example version: '2.1.0'. It appears in diagnostics, so it has to be the same string on every machine that builds this container.",
    })
  }

  return value
}

/* -------------------------------------------------------------------------- */
/* Container-level rules                                                       */
/* -------------------------------------------------------------------------- */

function assertContainerShape(
  sourceFile: ts.SourceFile,
  entryFile: string,
  definitions: readonly DiscoveredDefinition[],
): void {
  if (definitions.length === 0) {
    throw createBuildError({
      code: 'registry/invalid-descriptor',
      file: entryFile,
      operation: 'collect the definitions this container exports',
      expected: 'at least one exported App or Widget',
      observed: 'no definition',
      declaredBy: 'Static discovery',
      repair:
        "Export a definition from this module, for example `export const orders = createApp({ id: 'orders', router: makeRouter })`. Definitions declared anywhere else are not discovered.",
    })
  }

  const seen = new Map<string, DiscoveredDefinition>()
  for (const definition of definitions) {
    const existing = seen.get(definition.id)
    if (existing !== undefined) {
      throw createBuildError({
        code: 'registry/duplicate-id',
        file: entryFile,
        id: definition.id,
        operation: 'collect the definitions this container exports',
        expected: 'one definition per id',
        observed: `'${existing.exportName}' and '${definition.exportName}' both declare id '${definition.id}'`,
        declaredBy: 'The framework identity rules',
        repair:
          'Give each definition its own id. The id keys the shell registry, the storage prefix and the CSS scope, so two definitions sharing one would overwrite each other.',
      })
    }
    seen.set(definition.id, definition)
  }

  const apps = definitions.filter(definition => definition.kind === 'app')
  if (apps.length > 1) {
    throw createBuildError({
      code: 'registry/invalid-descriptor',
      file: entryFile,
      operation: 'collect the definitions this container exports',
      expected: 'at most one App per container',
      observed: `${apps.length} Apps (${listNames(apps.map(app => app.id))})`,
      declaredBy: 'The container contract',
      repair:
        'Split them into separate containers. A container deploys and versions as one unit, and an App owns routing for its whole subtree, so two of them cannot share one.',
    })
  }

  const defaultExports = definitions.filter(definition => definition.isDefaultExport)
  if (defaultExports.length > 0 && definitions.length > 1) {
    const offender = defaultExports[0]
    throw createBuildError({
      code: 'registry/invalid-descriptor',
      file: entryFile,
      ...(offender === undefined ? {} : { id: offender.id }),
      operation: 'collect the definitions this container exports',
      expected: 'named exports when a container exports more than one definition',
      observed: `a default export alongside ${definitions.length - 1} other definition(s)`,
      declaredBy: 'Static discovery',
      repair:
        "Give the default export a name, for example `export const orderRow = createWidget({ … })`. Named exports are canonical; a default export is only accepted when it is the container's only definition.",
    })
  }

  for (const definition of definitions) {
    if (definition.kind !== 'widget') continue
    assertUsableEventNames(sourceFile, entryFile, definition)
    assertUsableInputNames(sourceFile, entryFile, definition)
  }
}

function assertUsableEventNames(
  _sourceFile: ts.SourceFile,
  entryFile: string,
  definition: DiscoveredDefinition,
): void {
  const handlerProps = new Map<string, string>()

  for (const name of definition.eventNames) {
    if (!isValidEventName(name)) {
      throw createBuildError({
        code: 'contract/event-mismatch',
        file: entryFile,
        id: definition.id,
        operation: `read the Widget event '${name}'`,
        expected: 'a lower-camel-case event name, for example "acknowledged" or "selectionChanged"',
        observed: JSON.stringify(name),
        declaredBy: 'The Widget contract',
        repair: `Rename the event. Consumers subscribe to it as ${eventNameToHandlerProp('yourEvent')}, so the name has to survive that mapping.`,
      })
    }

    const handlerProp = eventNameToHandlerProp(name)
    const existing = handlerProps.get(handlerProp)
    if (existing !== undefined) {
      throw createBuildError({
        code: 'contract/event-mismatch',
        file: entryFile,
        id: definition.id,
        operation: `read the Widget event '${name}'`,
        expected: 'event names that map to distinct handler props',
        observed: `'${existing}' and '${name}' both map to ${handlerProp}`,
        declaredBy: 'The Widget contract',
        repair: `Rename one of them, for example '${name}Completed'. A consumer that passed ${handlerProp} could not say which event it meant.`,
      })
    }
    handlerProps.set(handlerProp, name)
  }
}

function assertUsableInputNames(
  _sourceFile: ts.SourceFile,
  entryFile: string,
  definition: DiscoveredDefinition,
): void {
  for (const name of definition.inputNames) {
    if (!isReservedInputName(name)) continue

    throw createBuildError({
      code: 'contract/input-mismatch',
      file: entryFile,
      id: definition.id,
      operation: `read the Widget input '${name}'`,
      expected: 'an input name that is not reserved for host control or event handlers',
      observed: `'${name}', which is reserved`,
      declaredBy: 'The Widget consumption contract',
      repair: `Rename the input. ${listNames([...RESERVED_INPUT_NAMES])} are host control props, and a name starting with "on" followed by a capital letter is an event handler.`,
    })
  }
}
