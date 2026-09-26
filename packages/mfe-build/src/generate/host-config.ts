/**
 * Runtime configuration for a host: the same `src/mfe.config.ts` declarations, deployment files and
 * local copy a container has, with a `#mfe/config` that validates without Zod. A host reads its
 * configuration before anything else on the page loads, sign-in included, so shipping Zod for it
 * would slow every first paint; the build already reads each schema statically into JSON Schema,
 * and the generated module checks against that. Its type still comes from the Zod declarations,
 * through an `import type` the bundler erases (docs/decisions.md §37).
 */

import { readConfigSource, type ConfigSource } from '../config/config-source.ts'
import { summarizeSchema } from '../config/zod-static.ts'
import { resolveOptions, type ContainerOptions } from '../options.ts'
import { envExampleFile, gitignoreFile, runtimeConfigSchemaFile } from './artifacts.ts'
import {
  banner,
  generatedPath,
  inventoryFile,
  joinBlocks,
  quote,
  relativeSpecifier,
  type GeneratedFile,
} from './emit.ts'
import {
  ALIASES,
  configErrorClass,
  configReadValues,
  type ConfigGenerateContext,
} from './modules.ts'
import {
  runtimeConfigDefaultsFile,
  runtimeConfigScriptFile,
  type RuntimeConfigPlan,
} from './runtime-config.ts'

export interface HostConfigOptions extends Pick<
  ContainerOptions,
  'generatedDir' | 'runtimeConfigFileName'
> {
  /** The directory holding the host's package.json and `src/mfe.config.ts`. */
  readonly root: string
  /** The integration writing the files, named in their banners. */
  readonly generator: string
  /** The modules `env` is imported from; the first is where `InferEnvConfig` comes from. */
  readonly envModules: readonly [string, ...string[]]
  /** A module the browser can load that exports `checkConfigField`, without Zod. */
  readonly checkModule: string
  /** The name the configuration's errors carry; defaults to the package name without its scope. */
  readonly id?: string
}

export interface HostConfigPlan extends RuntimeConfigPlan {
  readonly configSource: ConfigSource
  readonly files: readonly GeneratedFile[]
  /** `#mfe/config`, pointed at the generated module. */
  readonly aliases: Readonly<Record<string, string>>
  /** The declared defaults, which a build ships as the runtime configuration. */
  readonly defaults: GeneratedFile | null
}

interface HostConfigContext extends ConfigGenerateContext {
  readonly configSource: ConfigSource
  readonly host: { readonly id: string }
  readonly checkModule: string
}

/** `null` for a host that declares no `src/mfe.config.ts`, which then has no `#mfe/config`. */
export function planHostConfig(options: HostConfigOptions): HostConfigPlan | null {
  const resolved = resolveOptions(
    {
      containerRoot: options.root,
      ...(options.generatedDir === undefined ? {} : { generatedDir: options.generatedDir }),
      ...(options.runtimeConfigFileName === undefined
        ? {}
        : { runtimeConfigFileName: options.runtimeConfigFileName }),
    },
    'root',
  )
  const configSource = readConfigSource(resolved.containerRoot, options.envModules)
  if (configSource === undefined) return null

  const context: HostConfigContext = {
    options: resolved,
    configSource,
    profile: { generator: options.generator, envModules: options.envModules },
    host: { id: options.id ?? resolved.packageName.replace(/^@[^/]+\//, '') },
    checkModule: options.checkModule,
  }

  const defaults = runtimeConfigDefaultsFile(context)
  const files = [
    gitignoreFile(context),
    hostConfigModule(context),
    runtimeConfigSchemaFile(context),
    envExampleFile(context),
    defaults,
    runtimeConfigScriptFile(context),
  ].filter((file): file is GeneratedFile => file !== null)
  files.push(inventoryFile(resolved.generatedDir, files))

  return {
    options: resolved,
    configSource,
    files: [...files].sort((left, right) => (left.path < right.path ? -1 : 1)),
    aliases: { [ALIASES.config]: generatedPath(resolved.generatedDir, 'config.ts') },
    defaults,
  }
}

function hostConfigModule(context: HostConfigContext): GeneratedFile {
  const file = generatedPath(context.options.generatedDir, 'config.ts')
  const fields = context.configSource.fields.map(field => ({
    field: field.field,
    envVar: field.envVar,
    expected: summarizeSchema(field.schema),
    schema: field.schema.jsonSchema,
    optional: field.schema.optional,
    hasDefault: field.schema.hasDefault,
    ...(field.schema.defaultValue === undefined ? {} : { defaultValue: field.schema.defaultValue }),
    ...(field.schema.transforms === undefined ? {} : { transforms: field.schema.transforms }),
    ...(field.schema.coerce === undefined ? {} : { coerce: field.schema.coerce }),
    ...(field.api ? { api: true } : {}),
  }))

  return {
    path: file,
    contents: joinBlocks([
      banner(context.profile.generator, ALIASES.config),
      [
        `import { checkConfigField, type ConfigFieldSpec } from ${quote(context.checkModule)}`,
        `import type { InferEnvConfig } from ${quote(context.profile.envModules[0])}`,
        '',
        '// Type only, so the declarations, and Zod with them, never reach the bundle.',
        `import type descriptors from ${quote(relativeSpecifier(file, context.configSource.file))}`,
      ].join('\n'),
      [
        '/**',
        ' * The configuration this host was deployed with. The type comes from the schemas the',
        ' * author declared; the values are checked against the JSON Schema the build derived from',
        ' * them, so the two cannot drift and Zod never loads.',
        ' */',
        'export type MfeConfig = InferEnvConfig<typeof descriptors>',
      ].join('\n'),
      'declare const __webpack_public_path__: string | undefined',
      [
        '// The file sits beside the host document; `output.publicPath` says where that is.',
        'const publicPath = __webpack_public_path__',
        "const assetBase = typeof publicPath === 'string' && publicPath !== '' ? publicPath : './'",
        "const documentBase = typeof document === 'undefined' ? assetBase : document.baseURI",
        '',
        `const CONTAINER_ID = ${quote(context.host.id)}`,
        `const CONFIG_URL = new URL(${quote(
          context.options.runtimeConfigFileName,
        )}, new URL(assetBase, documentBase)).href`,
      ].join('\n'),
      `const FIELDS: readonly ConfigFieldSpec[] = ${JSON.stringify(fields, null, 2)}`,
      configErrorClass('host'),
      // Same-origin credentials and the default cache, so the request matches a
      // `<link rel="preload" as="fetch" crossorigin>` in the host document and is answered by it.
      configReadValues({
        subject: 'host',
        fetchInit: "{ credentials: 'same-origin' }",
        rejectNonJson: true,
      }),
      HOST_CONFIG_VALIDATE,
      [
        '/**',
        ' * Loaded once, before anything that imports it runs. An immutable snapshot: changing a',
        ' * value takes a new deployment and a page reload, and nothing polls.',
        ' */',
        'export const config: MfeConfig = validate(await readValues())',
        '',
        'export default config',
      ].join('\n'),
    ]),
  }
}

const HOST_CONFIG_VALIDATE = [
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
  '    const result = checkConfigField(spec, values[spec.field])',
  '    if (!result.ok) {',
  '      fail(',
  "        'config/invalid',",
  '        `validate ${spec.field}`,',
  '        spec.expected,',
  '        result.problem,',
  "        `Set ${spec.envVar} in the deployment that writes this host's runtime configuration, then reload the page.`,",
  '      )',
  '    }',
  '    parsed[spec.field] = result.value',
  '  }',
  '',
  '  return Object.freeze(parsed) as MfeConfig',
  '}',
].join('\n')
