/**
 * The generated modules. Three are aliases an author imports — `#mfe/config`,
 * `#mfe/fetch`, `#mfe/meta`. The rest are build artifacts: the Module
 * Federation entries and the per-Widget contract entry points.
 */

import { FRAMEWORK_CONTRACT_MAJOR } from '@company/mfe-core'

import type { ConfigSource } from '../config/config-source.ts'
import { summarizeSchema } from '../config/zod-static.ts'
import type { DiscoveredDefinition, DiscoveryResult } from '../discovery/definitions.ts'
import type { ContractImport, WidgetContractSource } from '../discovery/widget-contract.ts'
import type { ResolvedOptions } from '../options.ts'
import {
  banner,
  generatedPath,
  joinBlocks,
  quote,
  relativeSpecifier,
  type GeneratedFile,
} from './emit.ts'

export interface GenerateContext {
  readonly options: ResolvedOptions
  readonly entryFile: string
  readonly discovery: DiscoveryResult
  readonly configSource: ConfigSource | undefined
}

export const ALIASES = {
  config: '#mfe/config',
  fetch: '#mfe/fetch',
  meta: '#mfe/meta',
} as const

/**
 * Loads `runtime-config.json` — values only, no envelope — applies the schema
 * defaults the author declared, validates and freezes. Every failure throws
 * before the top-level await resolves, so an importer never observes a
 * half-configured container and nothing substitutes an empty object.
 */
export function configModule(context: GenerateContext): GeneratedFile | null {
  const source = context.configSource
  if (source === undefined) return null

  const file = generatedPath(context.options.generatedDir, 'config.ts')

  const fieldRows = source.fields.map(
    field =>
      `  { field: ${quote(field.field)}, envVar: ${quote(field.envVar)}, expected: ${quote(
        summarizeSchema(field.schema),
      )} },`,
  )
  const fieldUnion =
    source.fields.length === 0
      ? 'never'
      : source.fields.map(field => quote(field.field)).join(' | ')

  return {
    path: file,
    contents: joinBlocks([
      banner(ALIASES.config),
      [
        "import type { InferEnvConfig } from '@company/mfe-rspack'",
        '',
        `import descriptors from ${quote(relativeSpecifier(file, source.file))}`,
      ].join('\n'),
      [
        '/**',
        ' * The configuration this container was deployed with. The type comes from the',
        ' * schemas the author declared, so it cannot drift from what is validated.',
        ' */',
        'export type MfeConfig = InferEnvConfig<typeof descriptors>',
      ].join('\n'),
      'declare const __webpack_public_path__: string | undefined',
      [
        '// `output.publicPath: auto` resolves this to the deployed container, which is',
        '// what the configuration file sits next to. Resolving against the shell',
        '// document instead would break as soon as the two were served from different',
        '// paths.',
        'const publicPath = __webpack_public_path__',
        "const assetBase = typeof publicPath === 'string' && publicPath !== '' ? publicPath : './'",
        "const documentBase = typeof document === 'undefined' ? assetBase : document.baseURI",
        '',
        `const CONTAINER_ID = ${quote(containerId(context))}`,
        `const CONFIG_URL = new URL(${quote(
          context.options.runtimeConfigFileName,
        )}, new URL(assetBase, documentBase)).href`,
      ].join('\n'),
      [
        'interface FieldSpec {',
        `  readonly field: ${fieldUnion}`,
        '  readonly envVar: string',
        '  readonly expected: string',
        '}',
        '',
        'const FIELDS: readonly FieldSpec[] = [',
        ...fieldRows,
        ']',
      ].join('\n'),
      CONFIG_ERROR_CLASS,
      CONFIG_READ_VALUES,
      CONFIG_VALIDATE,
      [
        '/**',
        ' * Loaded once per deployed container and shared by every definition it',
        ' * exports. An immutable snapshot: changing a value takes a new deployment and',
        ' * a page reload, and nothing polls. The await is at the top level on purpose,',
        ' * so no module that imports this one runs before validation has passed.',
        ' */',
        'export const config: MfeConfig = validate(await readValues())',
        '',
        'export default config',
      ].join('\n'),
    ]),
  }
}

const CONFIG_ERROR_CLASS = [
  '// Carries the same fields as a framework error without importing one, so this',
  '// module resolves with nothing the container does not already have.',
  'class MfeConfigError extends Error {',
  '  readonly code: string',
  '  readonly id: string',
  '  readonly operation: string',
  '',
  '  constructor(code: string, operation: string, message: string, cause?: unknown) {',
  '    super(message, cause === undefined ? undefined : { cause })',
  "    this.name = 'MfeConfigError'",
  '    this.code = code',
  '    this.id = CONTAINER_ID',
  '    this.operation = operation',
  '  }',
  '}',
  '',
  'function fail(',
  '  code: string,',
  '  operation: string,',
  '  expected: string,',
  '  observed: string,',
  '  repair: string,',
  '  cause?: unknown,',
  '): never {',
  '  const message =',
  '    `${CONTAINER_ID} failed to ${operation}: expected ${expected}, received ${observed}.` +',
  '    ` The container configuration contract declares this expectation. ${repair}`',
  '  throw new MfeConfigError(code, operation, message, cause)',
  '}',
].join('\n')

const CONFIG_READ_VALUES = [
  'async function readValues(): Promise<unknown> {',
  '  let response: Response',
  '  try {',
  "    response = await fetch(CONFIG_URL, { cache: 'no-store', credentials: 'omit' })",
  '  } catch (cause) {',
  '    fail(',
  "      'config/unreachable',",
  "      'load its runtime configuration',",
  '      `a readable file at ${CONFIG_URL}`,',
  "      'a request that never completed',",
  "      'Check that the deployment publishes this file next to the container assets and that the browser can reach it.',",
  '      cause,',
  '    )',
  '  }',
  '',
  '  if (response.status === 404) {',
  '    fail(',
  "      'config/missing',",
  "      'load its runtime configuration',",
  '      `a file at ${CONFIG_URL}`,',
  "      '404 Not Found',",
  "      'Publish the runtime configuration with the container. The generated .env.example lists every value it has to carry, and the generated JSON Schema validates it before release.',",
  '    )',
  '  }',
  '',
  '  if (!response.ok) {',
  '    fail(',
  "      'config/unreachable',",
  "      'load its runtime configuration',",
  '      `a 200 response from ${CONFIG_URL}`,',
  '      `${response.status} ${response.statusText}`,',
  "      'Check how the deployment serves the file. A container cannot start without its configuration, so this is not retried in the background.',",
  '    )',
  '  }',
  '',
  '  try {',
  '    return (await response.json()) as unknown',
  '  } catch (cause) {',
  '    fail(',
  "      'config/invalid',",
  "      'read its runtime configuration',",
  "      'a JSON object of configuration values',",
  "      'a body that is not JSON',",
  "      'Check what the deployment wrote. The file carries values only: no envelope, no comments and no trailing commas.',",
  '      cause,',
  '    )',
  '  }',
  '}',
].join('\n')

const CONFIG_VALIDATE = [
  'function validate(raw: unknown): MfeConfig {',
  "  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {",
  '    fail(',
  "      'config/invalid',",
  "      'read its runtime configuration',",
  "      'a JSON object of configuration values',",
  "      raw === null ? 'null' : Array.isArray(raw) ? 'an array' : `a ${typeof raw}`,",
  "      'Write the file as a flat object of values. It carries no envelope and no metadata.',",
  '    )',
  '  }',
  '',
  '  const values = raw as Record<string, unknown>',
  '  const known = new Set<string>(FIELDS.map(spec => spec.field))',
  '  const unexpected = Object.keys(values).filter(key => !known.has(key))',
  '  if (unexpected.length > 0) {',
  '    fail(',
  "      'config/invalid',",
  "      'read its runtime configuration',",
  "      `only the declared fields (${[...known].join(', ')})`,",
  "      unexpected.join(', '),",
  "      'Remove the extra keys, or declare them with env() in src/mfe.config.ts. An undeclared key is usually a misspelled one, and ignoring it would silently fall back to a default.',",
  '    )',
  '  }',
  '',
  '  const parsed: Record<string, unknown> = {}',
  '  for (const spec of FIELDS) {',
  '    const result = descriptors[spec.field].schema.safeParse(values[spec.field])',
  '    if (!result.success) {',
  '      const issue = result.error.issues[0]',
  '      fail(',
  "        'config/invalid',",
  '        `validate ${spec.field}`,',
  '        spec.expected,',
  "        issue === undefined ? 'a value the schema rejected' : issue.message,",
  "        `Set ${spec.envVar} in the deployment that writes this container's runtime configuration, then reload the page.`,",
  '      )',
  '    }',
  '    parsed[spec.field] = result.data',
  '  }',
  '',
  '  return Object.freeze(parsed) as MfeConfig',
  '}',
].join('\n')

/**
 * Importing a bound fetch is the whole point: the global one is never replaced,
 * so nothing a container does here changes what the shell or another container
 * observes when it calls `fetch`.
 *
 * The session itself is the shell's and is resolved at call time. What the
 * build contributes is the part only it knows: the origins the author declared
 * `{ api: true }`, and the first of them as the default base for relative
 * request URLs (§10.4).
 *
 * The import is from `@company/mfe-react` rather than the host it re-exports
 * from, because that is the package a container already depends on — a
 * generated file must not oblige every project to add a dependency it never
 * writes an import for.
 */
export function fetchModule(context: GenerateContext): GeneratedFile {
  const apiFields = (context.configSource?.fields ?? []).filter(field => field.api)
  const baseField = apiFields[0]

  const origins =
    apiFields.length === 0
      ? '[]'
      : ['[', ...apiFields.map(field => `  new URL(config.${field.field}).origin,`), ']'].join('\n')

  return {
    path: generatedPath(context.options.generatedDir, 'fetch.ts'),
    contents: joinBlocks([
      banner(ALIASES.fetch),
      [
        "import { createContainerTransport } from '@company/mfe-react'",
        ...(apiFields.length === 0 ? [] : ['', "import { config } from './config.ts'"]),
      ].join('\n'),
      [
        '// The origins declared with env(…, { api: true }). A request to any other',
        '// origin is sent without a token rather than leaking the session to it.',
        `export const apiOrigins: readonly string[] = Object.freeze(${origins})`,
      ].join('\n'),
      [
        '/**',
        ' * Standard `fetch`, plus the tier-2 accessor for transports it cannot cover.',
        ' * Always await getAccessToken, call it per connection, and never store it.',
        ' */',
        'const transport = createContainerTransport({',
        `  id: ${quote(containerId(context))},`,
        ...(baseField === undefined ? [] : [`  apiBaseUrl: config.${baseField.field},`]),
        '  apiOrigins,',
        '})',
        '',
        'export const { fetch, getAccessToken } = transport',
      ].join('\n'),
    ]),
  }
}

export function metaModule(context: GenerateContext, buildHash: string): GeneratedFile {
  const rows = context.discovery.definitions.map(definition => {
    const version =
      definition.version === undefined ? '' : `, version: ${quote(definition.version)}`
    return `  { id: ${quote(definition.id)}, kind: ${quote(definition.kind)}${version} },`
  })

  return {
    path: generatedPath(context.options.generatedDir, 'meta.ts'),
    contents: joinBlocks([
      banner(ALIASES.meta),
      [
        'export interface DefinitionMeta {',
        '  readonly id: string',
        "  readonly kind: 'app' | 'widget'",
        '  readonly version?: string',
        '}',
      ].join('\n'),
      [
        '/** Stable across rebuilds of identical sources; changes when the shape does. */',
        `export const buildHash = ${quote(buildHash)}`,
        '',
        `export const buildTime = ${quote(context.options.buildTime)}`,
        '',
        `export const contractMajor = ${String(FRAMEWORK_CONTRACT_MAJOR)}`,
      ].join('\n'),
      ['export const definitions: readonly DefinitionMeta[] = Object.freeze([', ...rows, '])'].join(
        '\n',
      ),
    ]),
  }
}

/** Generated, and not public API. */
export function exposeName(definition: DiscoveredDefinition): string {
  return definition.kind === 'app' ? './app' : `./widgets/${definition.id}`
}

export function entryModulePath(
  context: GenerateContext,
  definition: DiscoveredDefinition,
): string {
  return definition.kind === 'app'
    ? generatedPath(context.options.generatedDir, 'entries', 'app.ts')
    : generatedPath(context.options.generatedDir, 'entries', 'widgets', `${definition.id}.ts`)
}

/** Where the bundler entry lives. A container has one only because it must. */
export function containerEntryPath(context: GenerateContext): string {
  return generatedPath(context.options.generatedDir, 'entries', 'container.ts')
}

/**
 * The bundler entry, which is deliberately empty.
 *
 * A container is only ever consumed through federation: a shell reads
 * `mf-manifest.json`, loads `remoteEntry.js` and pulls the exposed chunks.
 * Nothing ever requests an application entry. Pointing the bundler at the
 * container's own source instead builds the whole application a second time,
 * in a graph no one loads — around 220 kB of duplicate, deployed and never
 * served. The bundler still requires *an* entry, so it gets this one.
 */
export function containerEntryModule(context: GenerateContext): GeneratedFile {
  return {
    path: containerEntryPath(context),
    contents: joinBlocks([
      banner(),
      [
        '// Intentionally empty. This container is loaded through remoteEntry.js and',
        '// the exposed entries beside this file; nothing imports this module.',
        'export {}',
      ].join('\n'),
    ]),
  }
}

export function federationEntryModules(context: GenerateContext): readonly GeneratedFile[] {
  return context.discovery.definitions.map(definition => {
    const file = entryModulePath(context, definition)
    const exported = definition.isDefaultExport ? 'default' : definition.exportName

    const configImport =
      context.configSource === undefined
        ? ''
        : [
            '// Imported first, so a container whose configuration is missing or invalid',
            '// fails before any application module of this container evaluates.',
            `import ${quote(
              relativeSpecifier(file, generatedPath(context.options.generatedDir, 'config.ts')),
            )}`,
          ].join('\n')

    return {
      path: file,
      contents: joinBlocks([
        banner(),
        `// Module Federation expose: '${exposeName(definition)}'. Generated, not a public name.`,
        configImport,
        `export { ${exported} as definition } from ${quote(relativeSpecifier(file, context.entryFile))}`,
      ]),
    }
  })
}

/**
 * One side-effect-free module per exported Widget. A consumer imports it for
 * types and for validation on its own side, so it has to reach the schemas
 * without importing the container entry, which would drag in the App, its
 * router and the route tree. The schemas are therefore either re-exported from
 * the module they already live in or copied here verbatim.
 */
export function widgetContractModules(context: GenerateContext): readonly GeneratedFile[] {
  return context.discovery.widgets
    .filter(widget => widget.contractSource !== undefined)
    .map(widget => widgetContractModule(context, widget))
}

function widgetContractModule(
  context: GenerateContext,
  widget: DiscoveredDefinition,
): GeneratedFile {
  const source = widget.contractSource as WidgetContractSource
  const file = generatedPath(context.options.generatedDir, 'widgets', `${widget.id}.contract.ts`)

  const importLines: string[] = []
  const boundNames = new Set<string>()

  for (const entry of [...source.imports].sort((left, right) =>
    left.module < right.module ? -1 : 1,
  )) {
    const specifier = entry.isFile ? relativeSpecifier(file, entry.module) : entry.module
    const names = [...entry.names]
      .sort((left, right) => (left.local < right.local ? -1 : 1))
      .map(name =>
        name.imported === name.local ? name.local : `${name.imported} as ${name.local}`,
      )
    for (const name of entry.names) boundNames.add(name.local)
    importLines.push(`import { ${names.join(', ')} } from ${quote(specifier)}`)
  }

  const schemaLines: string[] = []
  const exportLines: string[] = []

  for (const field of ['inputs', 'events'] as const) {
    const binding = source[field]
    if (binding.kind === 'reexport') {
      const alias = binding.exported === field ? field : `${binding.exported} as ${field}`
      importLines.push(`import { ${alias} } from ${quote(relativeSpecifier(file, binding.file))}`)
      exportLines.push(`export { ${field} }`)
      continue
    }
    schemaLines.push(`export const ${field} = ${binding.expression}`)
  }

  const zod = zodBinding(source.imports, boundNames)
  if (zod.importLine !== null) importLines.unshift(zod.importLine)

  const eventsType =
    widget.eventNames.length === 0
      ? 'export type Events = Record<never, never>'
      : [
          'export type Events = {',
          ...widget.eventNames.map(
            name => `  readonly ${name}: ${zod.local}.infer<(typeof events)[${quote(name)}]>`,
          ),
          '}',
        ].join('\n')

  return {
    path: file,
    contents: joinBlocks([
      banner(),
      [
        `// The contract of the '${widget.id}' Widget. Side-effect free: it imports no App`,
        '// entry, no route tree, no generated configuration and no router augmentation,',
        '// so a consumer can depend on it without loading this container.',
      ].join('\n'),
      importLines.join('\n'),
      `export const widgetId = ${quote(widget.id)}`,
      [...source.prelude].join('\n'),
      schemaLines.join('\n'),
      exportLines.join('\n'),
      [`export type Inputs = ${zod.local}.infer<typeof inputs>`, '', eventsType].join('\n'),
    ]),
  }
}

/**
 * Reusing the author's own Zod binding avoids declaring a second one; when
 * there is none a type-only import is added, which erases completely and keeps
 * the module side-effect free.
 */
function zodBinding(
  imports: readonly ContractImport[],
  boundNames: ReadonlySet<string>,
): { readonly local: string; readonly importLine: string | null } {
  for (const entry of imports) {
    if (entry.module !== 'zod') continue
    for (const name of entry.names) {
      if (name.imported === 'z') return { local: name.local, importLine: null }
    }
  }

  if (!boundNames.has('z')) return { local: 'z', importLine: "import type { z } from 'zod'" }
  return { local: 'zodTypes', importLine: "import type { z as zodTypes } from 'zod'" }
}

/** The id a container reports itself as: its App's, or its first Widget's. */
export function containerId(context: GenerateContext): string {
  return context.discovery.app?.id ?? context.discovery.definitions[0]?.id ?? 'container'
}
