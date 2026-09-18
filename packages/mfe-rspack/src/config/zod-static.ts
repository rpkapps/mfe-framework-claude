/**
 * Reading a Zod schema without running it, for the JSON Schema and the
 * `.env.example` the build emits. The runtime still validates against the real
 * schemas. The set of Zod this understands is bounded, and a schema outside it
 * fails the build: an unreadable schema quietly producing an empty JSON Schema
 * would let the pipeline pass anything through.
 */

import { createBuildError } from '../diagnostics.ts'
import { describeNode, propertyName, ts, unwrapExpression } from '../discovery/ts-ast.ts'

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject

export interface JsonObject {
  readonly [key: string]: JsonValue
}

export interface StaticSchema {
  readonly jsonSchema: JsonObject
  /** True when the deployment may omit the field entirely. */
  readonly optional: boolean
  readonly hasDefault: boolean
  readonly defaultValue?: JsonValue
  readonly description?: string
}

interface ChainStep {
  readonly name: string
  readonly args: readonly ts.Expression[]
  readonly node: ts.Node
}

const STRING_FORMATS: ReadonlyMap<string, string> = new Map([
  ['url', 'uri'],
  ['email', 'email'],
  ['uuid', 'uuid'],
  ['ulid', 'ulid'],
  ['cuid', 'cuid'],
  ['ip', 'ipv4'],
  ['ipv4', 'ipv4'],
  ['ipv6', 'ipv6'],
  ['datetime', 'date-time'],
  ['date', 'date'],
  ['time', 'time'],
  ['duration', 'duration'],
])

/** Methods that change the value but not what the JSON must look like. */
const TRANSPARENT_METHODS = new Set([
  'trim',
  'toLowerCase',
  'toUpperCase',
  'readonly',
  'brand',
  'meta',
])

interface ReadSchemaContext {
  readonly file: string
  readonly field: string
  readonly sourceFile: ts.SourceFile
}

export function readStaticSchema(
  expression: ts.Expression,
  context: ReadSchemaContext,
): StaticSchema {
  const { base, steps } = chainOf(expression, context)

  let schema = readBase(base, context)
  let optional = false
  let hasDefault = false
  let defaultValue: JsonValue | undefined
  let description: string | undefined

  for (const step of steps) {
    switch (step.name) {
      case 'optional':
      case 'nullish':
        optional = true
        if (step.name === 'nullish') schema = nullable(schema)
        break
      case 'nullable':
        schema = nullable(schema)
        break
      case 'default':
        hasDefault = true
        optional = true
        defaultValue = readLiteralValue(step.args[0], context, step)
        schema = { ...schema, default: defaultValue }
        break
      case 'describe':
        description = readLiteralString(step, context)
        schema = { ...schema, description }
        break
      case 'min':
      case 'max':
      case 'length':
        schema = applyBound(schema, step, context)
        break
      case 'int':
        schema = { ...schema, type: 'integer' }
        break
      case 'positive':
        schema = { ...schema, exclusiveMinimum: 0 }
        break
      case 'nonnegative':
        schema = { ...schema, minimum: 0 }
        break
      case 'negative':
        schema = { ...schema, exclusiveMaximum: 0 }
        break
      case 'nonpositive':
        schema = { ...schema, maximum: 0 }
        break
      case 'regex':
        schema = { ...schema, pattern: readPattern(step, context) }
        break
      case 'startsWith':
        schema = { ...schema, pattern: `^${escapeRegExp(readLiteralString(step, context))}` }
        break
      case 'endsWith':
        schema = { ...schema, pattern: `${escapeRegExp(readLiteralString(step, context))}$` }
        break
      case 'catch':
        throw reject(
          context,
          step,
          '.catch(…), which replaces an invalid value instead of reporting it',
          'Use .default(…) for a value the deployment may omit, and let an invalid value fail. A container that silently substitutes configuration hides the misconfiguration until something downstream misbehaves.',
        )
      default:
        if (TRANSPARENT_METHODS.has(step.name)) break
        if (STRING_FORMATS.has(step.name)) {
          schema = { ...schema, type: 'string', format: STRING_FORMATS.get(step.name) ?? 'uri' }
          break
        }
        throw reject(
          context,
          step,
          `.${step.name}(…), which the build cannot read`,
          'Express the field with the schema methods the build understands (string, number, boolean, literal, enum, array, object, the string formats, min/max/length, regex, optional, nullable, default and describe), or move the extra checking into the code that consumes the value.',
        )
    }
  }

  return {
    jsonSchema: schema,
    optional,
    hasDefault,
    ...(defaultValue === undefined ? {} : { defaultValue }),
    ...(description === undefined ? {} : { description }),
  }
}

function chainOf(
  expression: ts.Expression,
  context: ReadSchemaContext,
): { readonly base: ChainStep; readonly steps: readonly ChainStep[] } {
  const steps: ChainStep[] = []
  let current: ts.Expression = unwrapExpression(expression)

  for (;;) {
    if (!ts.isCallExpression(current)) {
      throw reject(
        context,
        current,
        describeNode(context.sourceFile, current),
        'Write the schema as a Zod call, for example z.string().url(). The build reads it to emit the JSON Schema for runtime-config.json.',
      )
    }

    const callee = unwrapExpression(current.expression)

    if (ts.isIdentifier(callee)) {
      return {
        base: { name: callee.text, args: [...current.arguments], node: current },
        steps,
      }
    }

    if (!ts.isPropertyAccessExpression(callee)) {
      throw reject(
        context,
        current,
        describeNode(context.sourceFile, current),
        'Write the schema as a plain Zod call chain, for example z.string().min(1).',
      )
    }

    // `z.string()` and `z.coerce.number()` are both bases: coercion widens what
    // is accepted at runtime, not what the JSON is allowed to look like.
    const receiver = unwrapExpression(callee.expression)
    if (ts.isIdentifier(receiver) || ts.isPropertyAccessExpression(receiver)) {
      return {
        base: { name: callee.name.text, args: [...current.arguments], node: current },
        steps,
      }
    }

    steps.unshift({ name: callee.name.text, args: [...current.arguments], node: current })
    current = receiver
  }
}

function readBase(base: ChainStep, context: ReadSchemaContext): JsonObject {
  switch (base.name) {
    case 'string':
      return { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'int':
      return { type: 'integer' }
    case 'boolean':
      return { type: 'boolean' }
    case 'literal':
      return { const: readLiteralValue(base.args[0], context, base) }
    case 'enum': {
      const members = base.args[0] === undefined ? undefined : unwrapExpression(base.args[0])
      if (members === undefined || !ts.isArrayLiteralExpression(members)) {
        throw reject(
          context,
          base,
          'z.enum(…) without an array literal',
          "Write the members inline, for example z.enum(['staging', 'production']).",
        )
      }
      return { enum: members.elements.map(element => readLiteralValue(element, context, base)) }
    }
    case 'array': {
      const element = base.args[0]
      if (element === undefined) {
        throw reject(
          context,
          base,
          'z.array() without an element schema',
          'Give the array an element schema, for example z.array(z.string()).',
        )
      }
      return {
        type: 'array',
        items: readStaticSchema(element, { ...context, field: `${context.field}[]` }).jsonSchema,
      }
    }
    case 'object':
      return readObject(base, context)
    default: {
      const format = STRING_FORMATS.get(base.name)
      if (format !== undefined) return { type: 'string', format }
      throw reject(
        context,
        base,
        `z.${base.name}(…), which the build cannot read`,
        'Use one of the schema kinds the build understands: string (with a format), number, boolean, literal, enum, array or object. Configuration arrives as JSON, so anything richer has no JSON form to validate anyway.',
      )
    }
  }
}

function readObject(base: ChainStep, context: ReadSchemaContext): JsonObject {
  const argument = base.args[0]
  if (argument === undefined || !ts.isObjectLiteralExpression(unwrapExpression(argument))) {
    throw reject(
      context,
      base,
      'z.object(…) without an object literal',
      'Write the shape inline, for example z.object({ retries: z.number() }).',
    )
  }

  const shape = unwrapExpression(argument) as ts.ObjectLiteralExpression
  const properties: Record<string, JsonValue> = {}
  const required: string[] = []

  for (const property of shape.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = propertyName(property)
    if (name === null) continue
    const nested = readStaticSchema(property.initializer, {
      ...context,
      field: `${context.field}.${name}`,
    })
    properties[name] = nested.jsonSchema
    if (!nested.optional) required.push(name)
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

function applyBound(schema: JsonObject, step: ChainStep, context: ReadSchemaContext): JsonObject {
  const value = readLiteralValue(step.args[0], context, step)
  if (typeof value !== 'number') {
    throw reject(
      context,
      step,
      `.${step.name}(${render(value)})`,
      `Pass a numeric bound, for example .${step.name}(1).`,
    )
  }

  const type = schema['type']
  if (type === 'string') {
    if (step.name === 'length') return { ...schema, minLength: value, maxLength: value }
    return { ...schema, [step.name === 'min' ? 'minLength' : 'maxLength']: value }
  }
  if (type === 'array') {
    if (step.name === 'length') return { ...schema, minItems: value, maxItems: value }
    return { ...schema, [step.name === 'min' ? 'minItems' : 'maxItems']: value }
  }
  if (step.name === 'length') return { ...schema, minimum: value, maximum: value }
  return { ...schema, [step.name === 'min' ? 'minimum' : 'maximum']: value }
}

function readPattern(step: ChainStep, context: ReadSchemaContext): string {
  const node = step.args[0] === undefined ? undefined : unwrapExpression(step.args[0])
  if (node === undefined || !ts.isRegularExpressionLiteral(node)) {
    throw reject(
      context,
      step,
      '.regex(…) without a literal pattern',
      'Write the pattern inline, for example .regex(/^[a-z]+$/).',
    )
  }
  const text = node.getText(context.sourceFile)
  return text.slice(1, text.lastIndexOf('/'))
}

/**
 * A `JsonValue` rendered for an error message. `String()` would flatten an
 * object to `[object Object]`, which tells an author nothing about what they
 * actually wrote.
 */
function render(value: JsonValue): string {
  return JSON.stringify(value) ?? 'undefined'
}

/**
 * The argument of a step whose contract is a string. A non-string is the
 * author's mistake and is reported as one: coercing it would put
 * `[object Object]` into a description or a regular expression.
 */
function readLiteralString(step: ChainStep, context: ReadSchemaContext): string {
  const value = readLiteralValue(step.args[0], context, step)
  if (typeof value === 'string') return value

  throw reject(
    context,
    step,
    `.${step.name}(${render(value)})`,
    `Pass a string literal, for example .${step.name}('example').`,
  )
}

function readLiteralValue(
  argument: ts.Expression | undefined,
  context: ReadSchemaContext,
  step: ChainStep | ts.Node,
): JsonValue {
  if (argument === undefined) {
    throw reject(context, step, 'a missing argument', 'Pass a literal value.')
  }

  const node = unwrapExpression(argument)

  if (ts.isStringLiteralLike(node) && !ts.isTemplateExpression(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const operand = unwrapExpression(node.operand)
    if (ts.isNumericLiteral(operand)) return -Number(operand.text)
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map(element => readLiteralValue(element, context, step))
  }
  if (ts.isObjectLiteralExpression(node)) {
    const object: Record<string, JsonValue> = {}
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const name = propertyName(property)
      if (name === null) continue
      object[name] = readLiteralValue(property.initializer, context, step)
    }
    return object
  }

  throw reject(
    context,
    node,
    describeNode(context.sourceFile, node),
    'Write the value as a JSON literal. The build copies it into the generated JSON Schema and into .env.example, so it cannot be computed.',
  )
}

function nullable(schema: JsonObject): JsonObject {
  return { anyOf: [schema, { type: 'null' }] }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function reject(
  context: ReadSchemaContext,
  step: ChainStep | ts.Node,
  observed: string,
  repair: string,
): Error {
  const node = 'node' in step ? step.node : step
  const start = node.getStart(context.sourceFile)
  const { line, character } = context.sourceFile.getLineAndCharacterOfPosition(start)

  return createBuildError({
    code: 'config/invalid',
    file: context.file,
    line: line + 1,
    column: character + 1,
    id: context.field,
    operation: `read the schema for '${context.field}'`,
    expected: 'a schema the build can read without running it',
    observed,
    declaredBy: 'The generated runtime-config JSON Schema',
    repair,
  })
}

/** Plain-words summary of a field's shape, for `.env.example`. */
export function summarizeSchema(schema: StaticSchema): string {
  const node = schema.jsonSchema
  const enumValues = node['enum']
  if (Array.isArray(enumValues)) {
    return `one of ${enumValues.map(value => JSON.stringify(value)).join(', ')}`
  }
  const constant = node['const']
  if (constant !== undefined) return `exactly ${JSON.stringify(constant)}`

  const format = node['format']
  const type = node['type']
  if (type === 'string' && typeof format === 'string') return `a string in ${format} form`
  if (type === 'string') return 'a string'
  if (type === 'integer') return 'a whole number'
  if (type === 'number') return 'a number'
  if (type === 'boolean') return 'true or false'
  if (type === 'array') return 'a JSON array'
  if (type === 'object') return 'a JSON object'
  return 'a value matching the declared schema'
}
