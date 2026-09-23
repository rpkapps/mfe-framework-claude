/** Files the pipeline, the shell and the developer read; application code never imports them. */

import { FRAMEWORK_CONTRACT_MAJOR, type ContainerDescriptor } from '@company/mfe-core'
import type {
  CapabilityDescriptor,
  DefinitionFramework,
  ExportedDefinitionDescriptor,
} from '@company/mfe-core'

import { summarizeSchema, type JsonObject, type JsonValue } from '../config/zod-static.ts'
import { ALIASES, containerId, exposeName, type GenerateContext } from './modules.ts'
import { generatedPath, jsonFile, type GeneratedFile } from './emit.ts'

/** What the plugin embeds in the Module Federation manifest's metadata area. */
export interface FrameworkManifestMetadata {
  readonly kind: 'mfe'
  /** The framework contract major this container was built against. */
  readonly major: number
  /** The adapter that built it, when the integration names one; absent reads as React. */
  readonly framework?: DefinitionFramework
  readonly buildHash: string
  readonly buildTime: string
  readonly registryDescriptor: string
  readonly definitions: readonly ExportedDefinitionDescriptor[]
  /** Definition id to the generated Module Federation expose name. */
  readonly entries: Readonly<Record<string, string>>
}

/** `manifestUrl` is container-relative, because a baked-in absolute URL breaks a promotion. */
export function containerDescriptor(
  context: GenerateContext,
  capabilities: readonly CapabilityDescriptor[],
  buildHash: string,
): ContainerDescriptor {
  const definitions = context.discovery.definitions.map(definition => {
    const appCapabilities = definition.kind === 'app' && capabilities.length > 0 ? capabilities : []
    return {
      id: definition.id,
      kind: definition.kind,
      ...(definition.version === undefined ? {} : { version: definition.version }),
      ...(definition.title === undefined ? {} : { title: definition.title }),
      ...(definition.description === undefined ? {} : { description: definition.description }),
      ...(definition.tags === undefined ? {} : { tags: definition.tags }),
      ...(definition.icon === undefined ? {} : { icon: definition.icon }),
      ...(appCapabilities.length > 0 ? { capabilities: appCapabilities } : {}),
      // A Widget publishes what it takes so a host can catalogue it; an App takes a URL (§16).
      ...(definition.kind === 'widget'
        ? {
            contract: {
              events: definition.eventNames,
              ...(definition.inputSchema === undefined ? {} : { inputs: definition.inputSchema }),
            },
          }
        : {}),
    }
  })

  const entries: Record<string, string> = {}
  for (const definition of context.discovery.definitions) {
    entries[definition.id] = exposeName(definition)
  }

  const { framework } = context.profile
  return {
    manifestUrl: context.options.manifestFileName,
    container: context.options.federationName,
    contractMajor: FRAMEWORK_CONTRACT_MAJOR,
    // Written only when named, so a React container's entry is what it was before the field.
    ...(framework === undefined ? {} : { framework }),
    definitions,
    entries,
    build: { hash: buildHash, time: context.options.buildTime },
  }
}

/** Read from the same record, so the manifest and the registry entry cannot disagree. */
export function frameworkMetadata(
  context: GenerateContext,
  descriptor: ContainerDescriptor,
  buildHash: string,
): FrameworkManifestMetadata {
  return {
    kind: 'mfe',
    major: descriptor.contractMajor,
    ...(descriptor.framework === undefined ? {} : { framework: descriptor.framework }),
    buildHash,
    buildTime: context.options.buildTime,
    registryDescriptor: context.options.registryFileName,
    definitions: descriptor.definitions,
    entries: descriptor.entries,
  }
}

export function registryDescriptorFile(
  context: GenerateContext,
  descriptor: ContainerDescriptor,
): GeneratedFile {
  return {
    path: generatedPath(context.options.generatedDir, context.options.registryFileName),
    contents: jsonFile(descriptor),
  }
}

/** `additionalProperties: false`: an undeclared key is almost always a misspelled declared one. */
export function runtimeConfigSchemaFile(context: GenerateContext): GeneratedFile | null {
  const source = context.configSource
  if (source === undefined) return null

  const properties: Record<string, JsonValue> = {}
  const required: string[] = []

  for (const field of source.fields) {
    properties[field.field] = {
      ...field.schema.jsonSchema,
      ...(field.schema.jsonSchema['description'] === undefined
        ? { description: `${field.envVar}: ${summarizeSchema(field.schema)}` }
        : {}),
    }
    if (!field.schema.optional) required.push(field.field)
  }

  const schema: JsonObject = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `${containerId(context)} runtime configuration`,
    description: `Deployment values for the ${context.options.packageName} container. Values only: this file carries no envelope and no secrets beyond what the deployment chooses to place in it.`,
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }

  return {
    path: generatedPath(context.options.generatedDir, 'runtime-config.schema.json'),
    contents: jsonFile(schema),
  }
}

/** Derived from the `env()` declarations: names and expectations, never values. */
export function envExampleFile(context: GenerateContext): GeneratedFile | null {
  const source = context.configSource
  if (source === undefined) return null

  const lines: string[] = [
    `# Generated by ${context.profile.generator} from the env() declarations in src/mfe.config.ts.`,
    '# Do not edit, and do not commit real values: these names are what the deployment',
    `# writes into the runtime configuration for ${context.options.packageName}.`,
  ]

  for (const field of source.fields) {
    lines.push('')
    lines.push(`# ${field.field}: ${summarizeSchema(field.schema)}`)
    if (field.schema.description !== undefined) lines.push(`# ${field.schema.description}`)
    if (field.api) {
      lines.push(
        "# Declares an API origin: its origin joins this container's authentication allowlist.",
      )
    }
    if (field.schema.hasDefault) {
      lines.push(`# Optional. Defaults to ${JSON.stringify(field.schema.defaultValue)}.`)
    } else if (field.schema.optional) {
      lines.push('# Optional.')
    } else {
      lines.push('# Required.')
    }
    lines.push(`${field.envVar}=`)
  }

  return {
    path: generatedPath(context.options.generatedDir, '.env.example'),
    contents: `${lines.join('\n')}\n`,
  }
}

/** A container extends this from its own tsconfig, so `#mfe/*` resolves once. */
export function tsconfigPathsFile(context: GenerateContext): GeneratedFile {
  const paths: Record<string, readonly string[]> = {
    [ALIASES.fetch]: ['./fetch.ts'],
    [ALIASES.meta]: ['./meta.ts'],
  }
  if (context.configSource !== undefined) paths[ALIASES.config] = ['./config.ts']

  return {
    path: generatedPath(context.options.generatedDir, 'tsconfig.paths.json'),
    contents: jsonFile({
      $comment: `Generated by ${context.profile.generator}. Extend it from the container tsconfig so the #mfe/* aliases resolve for tsc and the editor.`,
      compilerOptions: { paths: Object.fromEntries(Object.entries(paths).sort()) },
    }),
  }
}

/** The generated directory is build output, so it stays out of version control. */
export function gitignoreFile(context: GenerateContext): GeneratedFile {
  return {
    path: generatedPath(context.options.generatedDir, '.gitignore'),
    contents: `# Generated by ${context.profile.generator}. Everything here is build output.\n*\n`,
  }
}
