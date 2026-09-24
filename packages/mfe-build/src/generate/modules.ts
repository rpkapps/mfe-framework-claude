/** Three of these are aliases an author imports; the rest are build artifacts. */

import { defaultExposePath, FRAMEWORK_CONTRACT_MAJOR } from '@company/mfe-core'

import type { ConfigSource } from '../config/config-source.ts'
import { summarizeSchema } from '../config/zod-static.ts'
import type { DiscoveredDefinition, DiscoveryResult } from '../discovery/definitions.ts'
import type { ContractImport, WidgetContractSource } from '../discovery/widget-contract.ts'
import type { ResolvedOptions } from '../options.ts'
import type { ContainerProfile } from '../profile.ts'
import {
  banner,
  generatedPath,
  joinBlocks,
  quote,
  relativeSpecifier,
  type GeneratedFile,
} from './emit.ts'
import { stylesheetRequest } from './styles.ts'

/** What the runtime-configuration files read: a container's context, or a host's. */
export interface ConfigGenerateContext {
  readonly options: ResolvedOptions
  readonly configSource: ConfigSource | undefined
  readonly profile: Pick<ContainerProfile, 'generator' | 'envModules'>
  /** Set for a host, whose files and errors are worded for it; a container leaves it out. */
  readonly host?: { readonly id: string }
}

export interface GenerateContext {
  readonly options: ResolvedOptions
  readonly entryFile: string
  readonly discovery: DiscoveryResult
  readonly configSource: ConfigSource | undefined
  readonly profile: ContainerProfile
  /** The share scopes a host registers this container with, `default` first. */
  readonly shareScopes: readonly string[]
}

export const ALIASES = {
  config: '#mfe/config',
  fetch: '#mfe/fetch',
  meta: '#mfe/meta',
} as const

/** Every failure throws before the top-level await resolves, so no import sees half a config. */
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
      banner(context.profile.generator, ALIASES.config),
      [
        `import type { InferEnvConfig } from ${quote(context.profile.envModules[0])}`,
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
      configErrorClass('container'),
      configReadValues({
        subject: 'container',
        fetchInit: "{ cache: 'no-store', credentials: 'omit' }",
        rejectNonJson: false,
      }),
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

/** Which side of the page loads the configuration, for the words its errors use. */
export type ConfigSubject = 'container' | 'host'

export function configErrorClass(subject: ConfigSubject): string {
  return [
    '// Carries the same fields as a framework error without importing one, so this',
    `// module resolves with nothing the ${subject} does not already have.`,
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
    '    ` The ' + subject + ' configuration contract declares this expectation. ${repair}`',
    '  throw new MfeConfigError(code, operation, message, cause)',
    '}',
  ].join('\n')
}

export interface ConfigReadOptions {
  readonly subject: ConfigSubject
  /** The `RequestInit` literal the file is fetched with. */
  readonly fetchInit: string
  /**
   * Whether a 200 that is not JSON is reported as a missing file: a server with a single-page
   * fallback answers a file it does not have with its index.html and a 200.
   */
  readonly rejectNonJson: boolean
}

export function configReadValues(options: ConfigReadOptions): string {
  const { subject } = options
  return [
    'async function readValues(): Promise<unknown> {',
    '  let response: Response',
    '  try {',
    `    response = await fetch(CONFIG_URL, ${options.fetchInit})`,
    '  } catch (cause) {',
    '    fail(',
    "      'config/unreachable',",
    "      'load its runtime configuration',",
    '      `a readable file at ${CONFIG_URL}`,',
    "      'a request that never completed',",
    `      'Check that the deployment publishes this file next to the ${subject} assets and that the browser can reach it.',`,
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
    `      'Publish the runtime configuration with the ${subject}. The generated .env.example lists every value it has to carry, and the generated JSON Schema validates it before release.',`,
    '    )',
    '  }',
    '',
    '  if (!response.ok) {',
    '    fail(',
    "      'config/unreachable',",
    "      'load its runtime configuration',",
    '      `a 200 response from ${CONFIG_URL}`,',
    '      `${response.status} ${response.statusText}`,',
    `      'Check how the deployment serves the file. A ${subject} cannot start without its configuration, so this is not retried in the background.',`,
    '    )',
    '  }',
    '',
    ...(options.rejectNonJson
      ? [
          "  const type = response.headers.get('Content-Type') ?? ''",
          "  if (!type.includes('json')) {",
          '    fail(',
          "      'config/missing',",
          "      'load its runtime configuration',",
          '      `a JSON file at ${CONFIG_URL}`,',
          "      type === '' ? 'a response with no content type' : type,",
          "      'The file is missing, and the server answered with its single-page fallback instead. Publish it with the deployment: the generated runtime-config.sh writes it from the environment.',",
          '    )',
          '  }',
          '',
        ]
      : []),
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
}

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
 * The global `fetch` is never replaced, so nothing a container does here changes what the shell
 * observes; the transport comes from the container's own adapter, which is what it depends on.
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
      banner(context.profile.generator, ALIASES.fetch),
      [
        `import { createContainerTransport } from ${quote(context.profile.adapterModule)}`,
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
      banner(context.profile.generator, ALIASES.meta),
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
  return defaultExposePath(definition.kind, definition.id)
}

export function entryModulePath(
  context: GenerateContext,
  definition: DiscoveredDefinition,
): string {
  return definition.kind === 'app'
    ? generatedPath(context.options.generatedDir, 'entries', 'app.ts')
    : generatedPath(context.options.generatedDir, 'entries', 'widgets', `${definition.id}.ts`)
}

/** Where the bundler entry lives; a container has one only because the bundler wants one. */
export function containerEntryPath(context: GenerateContext): string {
  return generatedPath(context.options.generatedDir, 'entries', 'container.ts')
}

/** Deliberately empty: nothing requests an application entry, but the bundler requires one. */
export function containerEntryModule(context: GenerateContext): GeneratedFile {
  return {
    path: containerEntryPath(context),
    contents: joinBlocks([
      banner(context.profile.generator),
      [
        '// Intentionally empty. This container is loaded through remoteEntry.js and',
        '// the exposed entries beside this file; nothing imports this module.',
        'export {}',
      ].join('\n'),
    ]),
  }
}

/**
 * The stylesheet is imported here rather than from the application, so it is part of every
 * exposed chunk and reaches the document before anything renders against it.
 */
export function federationEntryModules(context: GenerateContext): readonly GeneratedFile[] {
  return context.discovery.definitions.map(definition => {
    const file = entryModulePath(context, definition)
    const authored = relativeSpecifier(file, context.entryFile)

    const sideEffectImports = [
      "// The container's own stylesheet: its utilities, scoped to this",
      "// container's mount roots, and none of the page-level declarations the",
      '// shell owns.',
      `import ${quote(stylesheetRequest(context, file))}`,
      ...(context.configSource === undefined
        ? []
        : [
            '// Imported before the entry below, so a container whose configuration is',
            '// missing or invalid fails before any application module evaluates.',
            `import ${quote(
              relativeSpecifier(file, generatedPath(context.options.generatedDir, 'config.ts')),
            )}`,
          ]),
    ].join('\n')

    const exposed = context.profile.exposeDefinition?.(context, { file, definition, authored }) ?? [
      `export { ${exportedName(definition)} as definition } from ${quote(authored)}`,
    ]

    return {
      path: file,
      contents: joinBlocks([
        banner(context.profile.generator),
        `// Module Federation expose: '${exposeName(definition)}'. Generated, not a public name.`,
        sideEffectImports,
        ...exposed,
      ]),
    }
  })
}

/**
 * One side-effect-free module per exported Widget, so a consumer reaches the schemas without
 * importing the container entry and dragging in the App, its router and the route tree.
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
      banner(context.profile.generator),
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

/** A type-only import erases completely, which keeps the generated module side-effect free. */
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

/** The name an exposed entry imports the author's definition by. */
export function exportedName(definition: DiscoveredDefinition): string {
  return definition.isDefaultExport ? 'default' : definition.exportName
}

/** The id a container reports itself as: its App's, or its first Widget's. */
/** The name a configuration's files and errors carry: the host's, or the container's. */
export function configOwnerId(context: ConfigGenerateContext): string {
  if (context.host !== undefined) return context.host.id
  return 'discovery' in context ? containerId(context as GenerateContext) : 'container'
}

export function containerId(context: GenerateContext): string {
  return context.discovery.app?.id ?? context.discovery.definitions[0]?.id ?? 'container'
}
