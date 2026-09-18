/**
 * Reading `src/mfe.config.ts` statically, the same way definitions are read, so
 * the file cannot reach a network, a secret store or a `process.env` at build
 * time even by accident. The deployment values live in `runtime-config.json`.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createBuildError } from '../diagnostics.ts'
import {
  collectImportedBindings,
  describeNode,
  objectProperty,
  parseSourceFile,
  positionOf,
  propertyName,
  stringLiteralValue,
  ts,
  unwrapExpression,
} from '../discovery/ts-ast.ts'
import { ENV_NAME_RULE } from './env.ts'
import { readStaticSchema, type StaticSchema } from './zod-static.ts'

const CONFIG_MODULE_NAME = 'src/mfe.config.ts'
const ENV_MODULES = ['@company/mfe-rspack', '@company/mfe-rspack/env']

const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/
const FIELD_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/

export interface ConfigField {
  /** The property name on the config object the author's code reads. */
  readonly field: string
  /** The environment variable a deployment sets. */
  readonly envVar: string
  /** True when `{ api: true }` declared this value as an API origin. */
  readonly api: boolean
  readonly schema: StaticSchema
}

export interface ConfigSource {
  readonly file: string
  readonly fields: readonly ConfigField[]
}

/**
 * Reads the container's configuration declaration, or returns `undefined` when
 * the container declares none — a container with no configuration is normal and
 * gets no `#mfe/config` module.
 */
export function readConfigSource(containerRoot: string): ConfigSource | undefined {
  const file = join(containerRoot, CONFIG_MODULE_NAME)
  if (!existsSync(file)) return undefined

  const sourceFile = parseSourceFile(file)
  const imports = collectImportedBindings(sourceFile)

  const envLocals = new Set<string>()
  for (const [local, binding] of imports) {
    if (binding.imported === 'env' && ENV_MODULES.includes(binding.moduleSpecifier)) {
      envLocals.add(local)
    }
  }

  const declaration = findDefaultExportObject(sourceFile, file)
  const fields: ConfigField[] = []
  const seenEnvVars = new Map<string, string>()

  for (const property of declaration.properties) {
    if (!ts.isPropertyAssignment(property)) {
      const { line, column } = positionOf(sourceFile, property)
      throw createBuildError({
        code: 'config/invalid',
        file,
        line,
        column,
        operation: 'read the container configuration',
        expected: 'a property assigned an env(…) declaration',
        observed: describeNode(sourceFile, property),
        declaredBy: 'The configuration contract',
        repair:
          "Write each field as `name: env('ENV_VAR', schema)`. Spreads and shorthand hide where a value comes from, and the build reads this file without running it.",
      })
    }

    const field = propertyName(property)
    if (field === null || !FIELD_NAME_PATTERN.test(field)) {
      const { line, column } = positionOf(sourceFile, property)
      throw createBuildError({
        code: 'config/invalid',
        file,
        line,
        column,
        operation: 'read the container configuration',
        expected: 'a lower-camel-case field name',
        observed: field === null ? describeNode(sourceFile, property) : JSON.stringify(field),
        declaredBy: 'The configuration contract',
        repair:
          'Rename the field. It becomes a property on the object the generated #mfe/config module exports, so it has to be a plain identifier.',
      })
    }

    fields.push(readField(sourceFile, file, field, property.initializer, envLocals))
  }

  for (const entry of fields) {
    const existing = seenEnvVars.get(entry.envVar)
    if (existing !== undefined) {
      throw createBuildError({
        code: 'config/invalid',
        file,
        id: entry.envVar,
        operation: 'read the container configuration',
        expected: 'one field per environment variable',
        observed: `'${existing}' and '${entry.field}' both read ${entry.envVar}`,
        declaredBy: 'The configuration contract',
        repair:
          'Give each field its own variable, or read the single field in both places. Two fields sharing one variable makes the generated .env.example ambiguous about what the deployment has to set.',
      })
    }
    seenEnvVars.set(entry.envVar, entry.field)
  }

  return { file, fields }
}

function readField(
  sourceFile: ts.SourceFile,
  file: string,
  field: string,
  initializer: ts.Expression,
  envLocals: ReadonlySet<string>,
): ConfigField {
  const call = unwrapExpression(initializer)
  const { line, column } = positionOf(sourceFile, initializer)

  if (
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    !envLocals.has(call.expression.text)
  ) {
    throw createBuildError({
      code: 'config/invalid',
      file,
      line,
      column,
      id: field,
      operation: `read the configuration field '${field}'`,
      expected: 'an env(…) declaration',
      observed: describeNode(sourceFile, call),
      declaredBy: 'The configuration contract',
      repair: `Declare the field with env, for example ${field}: env('${toEnvName(field)}', z.string().url()). Only env() declarations carry the variable name the deployment sets.`,
    })
  }

  const envVar = stringLiteralValue(call.arguments[0])
  if (envVar === null || !ENV_NAME_PATTERN.test(envVar)) {
    throw createBuildError({
      code: 'config/invalid',
      file,
      line,
      column,
      id: field,
      operation: `read the configuration field '${field}'`,
      expected: `an environment variable name written inline: ${ENV_NAME_RULE}`,
      observed:
        call.arguments[0] === undefined
          ? 'no name'
          : (describeNode(sourceFile, call.arguments[0]) ?? ''),
      declaredBy: 'The configuration contract',
      repair: `Write it as a literal, for example env('${toEnvName(field)}', …). It is copied into .env.example, so the build has to be able to read it.`,
    })
  }

  const schemaExpression = call.arguments[1]
  if (schemaExpression === undefined) {
    throw createBuildError({
      code: 'config/invalid',
      file,
      line,
      column,
      id: field,
      operation: `read the configuration field '${field}'`,
      expected: 'a schema argument',
      observed: `env('${envVar}') with no schema`,
      declaredBy: 'The configuration contract',
      repair: `Pass the schema the value has to satisfy, for example env('${envVar}', z.string().url()).`,
    })
  }

  return {
    field,
    envVar,
    api: readApiFlag(sourceFile, file, field, call.arguments[2]),
    schema: readStaticSchema(schemaExpression, { file, field, sourceFile }),
  }
}

function readApiFlag(
  sourceFile: ts.SourceFile,
  file: string,
  field: string,
  argument: ts.Expression | undefined,
): boolean {
  if (argument === undefined) return false

  const options = unwrapExpression(argument)
  if (!ts.isObjectLiteralExpression(options)) {
    const { line, column } = positionOf(sourceFile, argument)
    throw createBuildError({
      code: 'config/invalid',
      file,
      line,
      column,
      id: field,
      operation: `read the configuration field '${field}'`,
      expected: 'an options object literal',
      observed: describeNode(sourceFile, options),
      declaredBy: 'The configuration contract',
      repair:
        'Write the options inline, for example { api: true }. The api flag builds the allowlist the authenticated fetch is bound to, so it has to be readable at build time.',
    })
  }

  const api = objectProperty(options, 'api')
  if (api === undefined) return false

  const kind = unwrapExpression(api.initializer).kind
  if (kind === ts.SyntaxKind.TrueKeyword) return true
  if (kind === ts.SyntaxKind.FalseKeyword) return false

  const { line, column } = positionOf(sourceFile, api)
  throw createBuildError({
    code: 'config/invalid',
    file,
    line,
    column,
    id: field,
    operation: `read the configuration field '${field}'`,
    expected: 'api: true or api: false',
    observed: describeNode(sourceFile, api.initializer),
    declaredBy: 'The configuration contract',
    repair:
      'Write the flag as a literal. An origin that is not declared here never receives a token, so the build has to know the answer without running anything.',
  })
}

function findDefaultExportObject(
  sourceFile: ts.SourceFile,
  file: string,
): ts.ObjectLiteralExpression {
  for (const statement of sourceFile.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals === true) continue
    const expression = unwrapExpression(statement.expression)
    if (ts.isObjectLiteralExpression(expression)) return expression

    const { line, column } = positionOf(sourceFile, statement)
    throw createBuildError({
      code: 'config/invalid',
      file,
      line,
      column,
      operation: 'read the container configuration',
      expected: 'a default-exported object literal',
      observed: describeNode(sourceFile, expression),
      declaredBy: 'The configuration contract',
      repair:
        "Export the object directly, for example `export default { apiBaseUrl: env('API_BASE_URL', z.string().url()) }`. The build reads the literal rather than running the module.",
    })
  }

  throw createBuildError({
    code: 'config/invalid',
    file,
    operation: 'read the container configuration',
    expected: 'a default export',
    observed: 'a configuration module without one',
    declaredBy: 'The configuration contract',
    repair:
      'Add `export default { … }` with one env() declaration per configuration field, or delete the file if this container needs no configuration.',
  })
}

/** The conventional variable name for a field, used in repair suggestions. */
function toEnvName(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase()
}
