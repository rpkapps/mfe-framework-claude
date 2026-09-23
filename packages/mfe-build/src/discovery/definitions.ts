/** Everything is read from syntax: no module is evaluated and no render function is called. */

import {
  DEFINITION_ID_RULE,
  eventNameToHandlerProp,
  findEventNameProblem,
  isReservedInputName,
  isValidDefinitionId,
  RESERVED_INPUT_NAMES,
  withoutUndefined,
  type DefinitionKind,
  type IconData,
} from '@company/mfe-core'

import type { JsonObject } from '../config/zod-static.ts'
import { createBuildError, listNames } from '../diagnostics.ts'
import { readIconData } from './icon.ts'
import { standaloneSources, type ContainerSources } from './sources.ts'
import { readWidgetContract, type WidgetContractSource } from './widget-contract.ts'
import {
  calleeName,
  collectImportedBindings,
  collectTopLevelBindings,
  describeNode,
  objectProperty,
  positionOf,
  stringLiteralValue,
  ts,
  unwrapExpression,
  walk,
  type ImportedBinding,
} from './ts-ast.ts'

/**
 * How one adapter's definitions read in source: where its factories are imported from, and the
 * examples a diagnostic suggests, in that adapter's own vocabulary.
 */
export interface DefinitionSyntax {
  /** The modules `createApp` and `createWidget` may be imported from. */
  readonly factoryModules: readonly string[]
  /** What follows the id in an example `createApp` call, for example `router: makeRouter`. */
  readonly appOptions: string
  /** An icon import and its use, such as `import { BellIcon } from '…' then icon: BellIcon`. */
  readonly iconExample: string
}

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
  /** Widget only: contract event names, in declaration order. */
  readonly eventNames: readonly string[]
  /** Widget only: input field names, when the schema could be read. */
  readonly inputNames: readonly string[]
  /** Widget only: the inputs as JSON Schema, when the build could read them. */
  readonly inputSchema?: JsonObject
  /** Widget only: how to reach the contract schemas without the App entry. */
  readonly contractSource?: WidgetContractSource
  /** Presentation the author declared, so a host can catalogue the definition unloaded (§16). */
  readonly title?: string
  readonly description?: string
  readonly tags?: readonly string[]
  readonly icon?: IconData
}

/** The author-declared presentation of one definition, all of it optional. */
interface Presentation {
  readonly title?: string
  readonly description?: string
  readonly tags?: readonly string[]
  readonly icon?: IconData
}

export interface DiscoveryResult {
  readonly definitions: readonly DiscoveredDefinition[]
  readonly app: DiscoveredDefinition | undefined
  readonly widgets: readonly DiscoveredDefinition[]
}

interface ExportedBinding {
  readonly exportName: string
  readonly isDefaultExport: boolean
  readonly expression: ts.Expression
}

/** Only `entryFile` is parsed; an import is read one level deep to reach a contract's schemas. */
export function discoverDefinitions(
  entryFile: string,
  syntax: DefinitionSyntax,
  sources: ContainerSources = standaloneSources(),
): DiscoveryResult {
  const sourceFile = sources.parse(entryFile)
  const imports = collectImportedBindings(sourceFile)
  const topLevel = collectTopLevelBindings(sourceFile)

  // Resolved through the import bindings, so `createWidget as make` is recognised by alias.
  const factories = new Map<string, DefinitionKind>()
  for (const [local, binding] of imports) {
    if (!syntax.factoryModules.includes(binding.moduleSpecifier)) continue
    const kind = FACTORY_KINDS.get(binding.imported)
    if (kind !== undefined) factories.set(local, kind)
  }

  assertEveryDefinitionIsExported(sourceFile, factories, topLevel)

  const definitions: DiscoveredDefinition[] = []
  for (const binding of collectExportedBindings(sourceFile, topLevel)) {
    const call = asFactoryCall(binding.expression, factories)
    if (call === null) continue
    definitions.push(
      readDefinition(sourceFile, entryFile, binding, call, { imports, topLevel, syntax, sources }),
    )
  }

  assertContainerShape(entryFile, definitions, syntax)

  return {
    definitions,
    app: definitions.find(definition => definition.kind === 'app'),
    widgets: definitions.filter(definition => definition.kind === 'widget'),
  }
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

function collectExportedBindings(
  sourceFile: ts.SourceFile,
  topLevel: ReadonlyMap<string, ts.Expression>,
): readonly ExportedBinding[] {
  const bindings: ExportedBinding[] = []

  for (const statement of sourceFile.statements) {
    if (
      ts.isVariableStatement(statement) &&
      (ts.getModifiers(statement) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        if (declaration.initializer === undefined) continue
        bindings.push({
          exportName: declaration.name.text,
          isDefaultExport: false,
          expression: declaration.initializer,
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
        })
      }
    }
  }

  return bindings
}

/** A `createWidget` call the entry never exports is almost always a forgotten `export`. */
function assertEveryDefinitionIsExported(
  sourceFile: ts.SourceFile,
  factories: ReadonlyMap<string, DefinitionKind>,
  topLevel: ReadonlyMap<string, ts.Expression>,
): void {
  const exportedExpressions = new Set(
    collectExportedBindings(sourceFile, topLevel).map(binding =>
      unwrapExpression(binding.expression),
    ),
  )

  walk(sourceFile, node => {
    if (!ts.isCallExpression(node)) return
    const callee = calleeName(node)
    if (callee === null || !factories.has(callee)) return
    if (exportedExpressions.has(node)) return

    const { line, column } = positionOf(sourceFile, node)
    throw createBuildError({
      code: 'registry/invalid-entry',
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

/** What the entry declares around its definitions, read once for all of them. */
interface EntryScope {
  readonly imports: ReadonlyMap<string, ImportedBinding>
  readonly topLevel: ReadonlyMap<string, ts.Expression>
  readonly syntax: DefinitionSyntax
  readonly sources: ContainerSources
}

function readDefinition(
  sourceFile: ts.SourceFile,
  entryFile: string,
  binding: ExportedBinding,
  factory: FactoryCall,
  { imports, topLevel, syntax, sources }: EntryScope,
): DiscoveredDefinition {
  const id = readIdentity(sourceFile, factory)
  const version = readVersion(sourceFile, factory, id)
  const contract =
    factory.kind === 'app'
      ? null
      : readWidgetContract(sourceFile, entryFile, factory, id, imports, topLevel, sources)
  const presentation = readPresentation(sourceFile, entryFile, factory, id, imports, syntax)

  return withoutUndefined({
    id,
    kind: factory.kind,
    version,
    ...presentation,
    exportName: binding.exportName,
    isDefaultExport: binding.isDefaultExport,
    eventNames: contract?.eventNames ?? [],
    inputNames: contract?.inputNames ?? [],
    inputSchema: contract?.inputSchema,
    contractSource: contract === null ? undefined : contract.source,
  })
}

/**
 * Title, description, tags and icon: what a catalogue needs before any container is fetched
 * (§16). The icon is an imported identifier rather than a string, so an author reaches for it
 * the way they reach for any other icon, and the build turns it into data.
 */
function readPresentation(
  sourceFile: ts.SourceFile,
  entryFile: string,
  factory: FactoryCall,
  id: string,
  imports: ReadonlyMap<string, ImportedBinding>,
  syntax: DefinitionSyntax,
): Presentation {
  return withoutUndefined({
    title: readPresentationString(sourceFile, factory, id, 'title'),
    description: readPresentationString(sourceFile, factory, id, 'description'),
    tags: readTags(sourceFile, factory, id),
    icon: readIcon(sourceFile, entryFile, factory, id, imports, syntax),
  })
}

function readPresentationString(
  sourceFile: ts.SourceFile,
  factory: FactoryCall,
  id: string,
  name: string,
): string | undefined {
  const property = objectProperty(factory.options, name)
  if (property === undefined) return undefined

  const value = stringLiteralValue(property.initializer)
  if (value === null) {
    const { line, column } = positionOf(sourceFile, property)
    throw createBuildError({
      code: 'registry/invalid-entry',
      file: sourceFile.fileName,
      line,
      column,
      id,
      operation: `read the definition ${name}`,
      expected: 'a plain string literal',
      observed: describeNode(sourceFile, property.initializer),
      declaredBy: 'Static discovery',
      repair: `Write the ${name} inline. It is read at build time and published in the registry, so it cannot be computed at runtime.`,
    })
  }

  return value
}

function readTags(
  sourceFile: ts.SourceFile,
  factory: FactoryCall,
  id: string,
): readonly string[] | undefined {
  const property = objectProperty(factory.options, 'tags')
  if (property === undefined) return undefined

  const array = unwrapExpression(property.initializer)
  const tags: string[] = []
  if (ts.isArrayLiteralExpression(array)) {
    for (const element of array.elements) {
      const value = stringLiteralValue(unwrapExpression(element))
      if (value !== null && value !== '') tags.push(value)
    }
  }

  if (!ts.isArrayLiteralExpression(array) || tags.length !== array.elements.length) {
    const { line, column } = positionOf(sourceFile, property)
    throw createBuildError({
      code: 'registry/invalid-entry',
      file: sourceFile.fileName,
      line,
      column,
      id,
      operation: 'read the definition tags',
      expected: 'an array of plain, non-empty string literals',
      observed: describeNode(sourceFile, property.initializer),
      declaredBy: 'Static discovery',
      repair:
        "Write the tags inline, for example tags: ['alerts', 'operations']. A host filters its catalogue on them without loading the container.",
    })
  }

  return tags
}

/**
 * The identifier is followed through ordinary ESM by `readIconData`, which names no icon library.
 * A failure is a build error rather than a dropped icon: a catalogue entry that silently lost its
 * icon is harder to notice than a build that stopped.
 */
function readIcon(
  sourceFile: ts.SourceFile,
  entryFile: string,
  factory: FactoryCall,
  id: string,
  imports: ReadonlyMap<string, ImportedBinding>,
  syntax: DefinitionSyntax,
): IconData | undefined {
  const property = objectProperty(factory.options, 'icon')
  if (property === undefined) return undefined

  const reference = unwrapExpression(property.initializer)
  const binding = ts.isIdentifier(reference) ? imports.get(reference.text) : undefined
  const icon = binding === undefined ? null : readIconData(entryFile, binding)

  if (icon === null) {
    const { line, column } = positionOf(sourceFile, property)
    throw createBuildError({
      code: 'registry/invalid-entry',
      file: sourceFile.fileName,
      line,
      column,
      id,
      operation: 'read the definition icon',
      expected: 'an imported identifier the build can resolve to a drawable icon',
      observed: describeNode(sourceFile, property.initializer),
      declaredBy: 'Static discovery',
      repair: `Import the icon and pass the identifier, for example ${syntax.iconExample}. The registry carries shapes rather than a component, so the build reads the icon from the module the import names; importing the .svg directly works for any icon.`,
    })
  }

  return icon
}

function readIdentity(sourceFile: ts.SourceFile, factory: FactoryCall): string {
  const property = objectProperty(factory.options, 'id')
  const { line, column } = positionOf(sourceFile, property ?? factory.call)

  if (property === undefined) {
    throw createBuildError({
      code: 'registry/invalid-entry',
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
      code: 'registry/invalid-entry',
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
      code: 'registry/invalid-entry',
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
      code: 'registry/invalid-entry',
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

function assertContainerShape(
  entryFile: string,
  definitions: readonly DiscoveredDefinition[],
  syntax: DefinitionSyntax,
): void {
  if (definitions.length === 0) {
    throw createBuildError({
      code: 'registry/invalid-entry',
      file: entryFile,
      operation: 'collect the definitions this container exports',
      expected: 'at least one exported App or Widget',
      observed: 'no definition',
      declaredBy: 'Static discovery',
      repair: `Export a definition from this module, for example \`export const orders = createApp({ id: 'orders', ${syntax.appOptions} })\`. Definitions declared anywhere else are not discovered.`,
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
      code: 'registry/invalid-entry',
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
      code: 'registry/invalid-entry',
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
    assertUsableEventNames(entryFile, definition)
    assertUsableInputNames(entryFile, definition)
  }
}

function assertUsableEventNames(entryFile: string, definition: DiscoveredDefinition): void {
  const problem = findEventNameProblem(definition.eventNames)
  if (problem === null) return

  if (problem.kind === 'invalid') {
    throw createBuildError({
      code: 'contract/event-mismatch',
      file: entryFile,
      id: definition.id,
      operation: `read the Widget event '${problem.name}'`,
      expected: 'a lower-camel-case event name, for example "acknowledged" or "selectionChanged"',
      observed: JSON.stringify(problem.name),
      declaredBy: 'The Widget contract',
      repair: `Rename the event. Consumers subscribe to it as ${eventNameToHandlerProp('yourEvent')}, so the name has to survive that mapping.`,
    })
  }

  throw createBuildError({
    code: 'contract/event-mismatch',
    file: entryFile,
    id: definition.id,
    operation: `read the Widget event '${problem.name}'`,
    expected: 'event names that map to distinct handler props',
    observed: `'${problem.existing}' and '${problem.name}' both map to ${problem.handlerProp}`,
    declaredBy: 'The Widget contract',
    repair: `Rename one of them, for example '${problem.name}Completed'. A consumer that passed ${problem.handlerProp} could not say which event it meant.`,
  })
}

function assertUsableInputNames(entryFile: string, definition: DiscoveredDefinition): void {
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
