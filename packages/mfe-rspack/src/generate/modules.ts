/**
 * The generated modules.
 *
 * Three of them are aliases an author imports — `#mfe/config`, `#mfe/fetch` and
 * `#mfe/meta`. The rest are build artifacts: the Module Federation entry
 * modules, the per-Widget contract entry points and the asset-base helper.
 * Nothing outside the three aliases is a public name, and nothing here is
 * hand-imported by path.
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

/** The alias every author-facing generated module is imported as. */
export const ALIASES = {
  config: '#mfe/config',
  fetch: '#mfe/fetch',
  meta: '#mfe/meta',
} as const

/* -------------------------------------------------------------------------- */
/* #mfe/config                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The validated, typed configuration module.
 *
 * It loads `runtime-config.json` — values only, no envelope — applies the
 * schema defaults the author declared, validates, and freezes the result. Every
 * failure path throws before the top-level await resolves, so an importer never
 * observes a half-configured container, and there is no code path that
 * substitutes an empty object.
 */
export function configModule(context: GenerateContext): GeneratedFile | null {
  const source = context.configSource
  if (source === undefined) return null

  const file = generatedPath(context.options.generatedDir, 'config.ts')
  const descriptorSpecifier = relativeSpecifier(file, source.file)

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
        `import descriptors from ${quote(descriptorSpecifier)}`,
        "import { assetUrl } from './asset-base.ts'",
      ].join('\n'),
      [
        '/**',
        ' * The configuration this container was deployed with. The type comes from the',
        ' * schemas the author declared, so it cannot drift from what is validated.',
        ' */',
        'export type MfeConfig = InferEnvConfig<typeof descriptors>',
      ].join('\n'),
      [
        `const CONTAINER_ID = ${quote(containerId(context))}`,
        `const CONFIG_URL = assetUrl(${quote(context.options.runtimeConfigFileName)})`,
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
        ' * exports. The snapshot is immutable: changing a value takes a new deployment',
        ' * and a page reload, and nothing polls for changes.',
        ' *',
        ' * The await is at the top level on purpose. No module that imports this one',
        ' * can run before the configuration has been loaded and validated.',
        ' */',
        'export const config: MfeConfig = validate(await readValues())',
        '',
        'export default config',
      ].join('\n'),
    ]),
  }
}

const CONFIG_ERROR_CLASS = [
  '/**',
  ' * Carries the same fields as a framework error without importing one, so this',
  ' * module resolves with nothing but the zod the container already has.',
  ' */',
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
  '        `Set ${spec.envVar} in the deployment that writes this container runtime configuration, then reload the page.`,',
  '      )',
  '    }',
  '    parsed[spec.field] = result.data',
  '  }',
  '',
  '  return Object.freeze(parsed) as MfeConfig',
  '}',
].join('\n')

/* -------------------------------------------------------------------------- */
/* #mfe/fetch                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The authenticated `fetch` and `getAccessToken`, bound to the origins this
 * container declared. Importing a bound function is the whole point: the global
 * `fetch` is never replaced, so nothing a container does here changes what the
 * shell or another container observes when it calls `fetch`.
 */
export function fetchModule(context: GenerateContext): GeneratedFile {
  const file = generatedPath(context.options.generatedDir, 'fetch.ts')
  const apiFields = (context.configSource?.fields ?? []).filter(field => field.api)

  const originExpression =
    apiFields.length === 0
      ? '[]'
      : ['[', ...apiFields.map(field => `    config.${field.field},`), '  ].map(value => new URL(value).origin)'].join(
          '\n',
        )

  return {
    path: file,
    contents: joinBlocks([
      banner(ALIASES.fetch),
      [
        "import { createAuthenticatedFetch, getAccessToken as requestAccessToken } from '@company/mfe-host'",
        ...(apiFields.length === 0 ? [] : ["import { config } from './config.ts'"]),
      ].join('\n'),
      `const CONTAINER_ID = ${quote(containerId(context))}`,
      [
        '/**',
        ' * The origins this container declared with env(…, { api: true }). A request to',
        ' * any other origin is refused rather than sent without a token.',
        ' */',
        `export const apiOrigins: readonly string[] = Object.freeze(${originExpression})`,
      ].join('\n'),
      'const binding = Object.freeze({ id: CONTAINER_ID, origins: apiOrigins })',
      [
        '/**',
        ' * The authenticated fetch for this container: a value you import, never a',
        ' * replacement for the global one.',
        ' */',
        'const authenticatedFetch = createAuthenticatedFetch(binding)',
        '',
        'export { authenticatedFetch as fetch }',
      ].join('\n'),
      [
        '/** The access token for one declared origin, for callers that need it directly. */',
        "export function getAccessToken(origin: string = apiOrigins[0] ?? ''): Promise<string> {",
        '  return requestAccessToken({ ...binding, origin })',
        '}',
      ].join('\n'),
    ]),
  }
}

/* -------------------------------------------------------------------------- */
/* #mfe/meta                                                                   */
/* -------------------------------------------------------------------------- */

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
        '/** One record per definition this container exports. */',
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
        '/** The framework contract major this container was built against. */',
        `export const contractMajor = ${String(FRAMEWORK_CONTRACT_MAJOR)}`,
      ].join('\n'),
      ['export const definitions: readonly DefinitionMeta[] = Object.freeze([', ...rows, '])'].join(
        '\n',
      ),
    ]),
  }
}

/* -------------------------------------------------------------------------- */
/* Asset base                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Container-relative asset resolution.
 *
 * `output.publicPath: 'auto'` makes the bundler resolve the container's own
 * script URL at runtime, and that is the base every asset the container ships
 * is relative to. Resolving against the shell document instead would break the
 * moment the shell was served from a different path than the container.
 */
export function assetBaseModule(context: GenerateContext): GeneratedFile {
  return {
    path: generatedPath(context.options.generatedDir, 'asset-base.ts'),
    contents: joinBlocks([
      banner(),
      'declare const __webpack_public_path__: string | undefined',
      [
        "/** The deployed container's asset base, resolved by the bundler at runtime. */",
        'const resolvedBase = __webpack_public_path__',
        '',
        'export const assetBase: string =',
        "  typeof resolvedBase === 'string' && resolvedBase !== '' ? resolvedBase : './'",
      ].join('\n'),
      [
        '/** Resolves a container-relative path against the deployed container. */',
        'export function assetUrl(path: string): string {',
        "  const documentBase = typeof document === 'undefined' ? assetBase : document.baseURI",
        '  return new URL(path, new URL(assetBase, documentBase)).href',
        '}',
      ].join('\n'),
    ]),
  }
}

/* -------------------------------------------------------------------------- */
/* Module Federation entries                                                   */
/* -------------------------------------------------------------------------- */

/** The expose name for a definition. Generated, and not public API. */
export function exposeName(definition: DiscoveredDefinition): string {
  return definition.kind === 'app' ? './app' : `./widgets/${definition.id}`
}

/** The generated module each expose points at. */
export function entryModulePath(
  context: GenerateContext,
  definition: DiscoveredDefinition,
): string {
  return definition.kind === 'app'
    ? generatedPath(context.options.generatedDir, 'entries', 'app.ts')
    : generatedPath(context.options.generatedDir, 'entries', 'widgets', `${definition.id}.ts`)
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
              relativeSpecifier(
                file,
                generatedPath(context.options.generatedDir, 'config.ts'),
              ),
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

/* -------------------------------------------------------------------------- */
/* Widget contract entry points                                                */
/* -------------------------------------------------------------------------- */

/**
 * One side-effect-free module per exported Widget, carrying its schemas and the
 * types inferred from them.
 *
 * A consumer imports this for types and for validation on its own side. It has
 * to reach the schemas without importing the container entry, which would drag
 * in the App, its router and the generated route tree — which is why the
 * schemas are either re-exported from the module they already live in or copied
 * here verbatim.
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
      .map(name => (name.imported === name.local ? name.local : `${name.imported} as ${name.local}`))
    for (const name of entry.names) boundNames.add(name.local)
    importLines.push(`import { ${names.join(', ')} } from ${quote(specifier)}`)
  }

  const schemaLines: string[] = []
  const exportLines: string[] = []

  for (const field of ['inputs', 'events'] as const) {
    const binding = source[field]
    if (binding.kind === 'reexport') {
      const specifier = relativeSpecifier(file, binding.file)
      const alias = binding.exported === field ? field : `${binding.exported} as ${field}`
      importLines.push(`import { ${alias} } from ${quote(specifier)}`)
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
 * Which local name the generated types use for Zod. Reusing the author's own
 * binding avoids declaring a second one; when there is none, a type-only import
 * is added, which erases completely and keeps the module side-effect free.
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

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

/** The id a container reports itself as: its App's, or its first Widget's. */
export function containerId(context: GenerateContext): string {
  return context.discovery.app?.id ?? context.discovery.definitions[0]?.id ?? 'container'
}
