/**
 * Conservative set inclusion for the JSON Schema subset used at Widget boundaries. No validator
 * or schema converter ships with this checker. Unsupported constraints are unknown, never a
 * promise that two independent releases are compatible; actual payload validation still runs.
 */

import type { WidgetContract } from './contract.ts'
import type { JsonSchemaObject, JsonSchemaValue, PublishedContract } from './definition.ts'

export type ContractCompatibilityStatus = 'compatible' | 'incompatible' | 'unknown'

export interface ContractCompatibilityIssue {
  readonly status: 'incompatible' | 'unknown'
  readonly direction: 'input' | 'output'
  readonly path: readonly (string | number)[]
  readonly reason: string
}

export interface ContractCompatibility {
  readonly status: ContractCompatibilityStatus
  readonly issues: readonly ContractCompatibilityIssue[]
}

const ANNOTATIONS: readonly string[] = ['$schema', 'title', 'description', 'default', 'examples']
const KEYWORDS: readonly string[] = [
  'type',
  'enum',
  'const',
  'anyOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
  'format',
  'x-mfe-tolerant-input',
]

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function merge(results: readonly ContractCompatibilityStatus[]): ContractCompatibilityStatus {
  return results.includes('incompatible')
    ? 'incompatible'
    : results.includes('unknown')
      ? 'unknown'
      : 'compatible'
}

function types(schema: JsonSchemaObject): readonly string[] | undefined {
  const type = schema['type']
  return typeof type === 'string'
    ? [type]
    : Array.isArray(type) && type.every(value => typeof value === 'string')
      ? type
      : undefined
}

function enumValues(schema: JsonSchemaObject): readonly JsonSchemaValue[] | undefined {
  return schema['const'] !== undefined
    ? [schema['const']]
    : Array.isArray(schema['enum'])
      ? schema['enum']
      : undefined
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function asSchema(value: unknown): JsonSchemaObject | undefined {
  return object(value) as JsonSchemaObject | undefined
}

function branches(schema: JsonSchemaObject): readonly JsonSchemaObject[] | undefined {
  const values = schema['anyOf']
  if (!Array.isArray(values)) return undefined
  const schemas = values.map(asSchema)
  return schemas.every(value => value !== undefined) ? schemas : undefined
}

function bound(
  schema: JsonSchemaObject,
  lower: boolean,
): { value: number; exclusive: boolean } | undefined {
  const inclusive = schema[lower ? 'minimum' : 'maximum']
  const exclusive = schema[lower ? 'exclusiveMinimum' : 'exclusiveMaximum']
  const values = [
    ...(typeof inclusive === 'number' ? [{ value: inclusive, exclusive: false }] : []),
    ...(typeof exclusive === 'number' ? [{ value: exclusive, exclusive: true }] : []),
  ]
  return values.sort(
    (a, b) =>
      (lower ? b.value - a.value : a.value - b.value) || Number(b.exclusive) - Number(a.exclusive),
  )[0]
}

/** Is every value permitted by `produced` also permitted by `accepted`? */
export function compareJsonSchemas(
  produced: JsonSchemaObject | undefined,
  accepted: JsonSchemaObject | undefined,
  depth = 0,
): ContractCompatibilityStatus {
  if (produced === undefined || accepted === undefined || depth > 32) return 'unknown'
  const unknown = [produced, accepted].some(schema =>
    Object.keys(schema).some(key => !ANNOTATIONS.includes(key) && !KEYWORDS.includes(key)),
  )
  const sourceUnion = branches(produced)
  if (sourceUnion !== undefined) {
    // Sibling constraints on a union require an intersection solver, deliberately not bundled.
    if (Object.keys(produced).some(key => key !== 'anyOf' && !ANNOTATIONS.includes(key)))
      return 'unknown'
    const result = merge(sourceUnion.map(branch => compareJsonSchemas(branch, accepted, depth + 1)))
    return unknown && result === 'compatible' ? 'unknown' : result
  }
  const targetUnion = branches(accepted)
  if (targetUnion !== undefined) {
    if (Object.keys(accepted).some(key => key !== 'anyOf' && !ANNOTATIONS.includes(key)))
      return 'unknown'
    const values = enumValues(produced)
    if (values !== undefined && values.length > 1)
      return merge(values.map(value => compareJsonSchemas({ const: value }, accepted, depth + 1)))
    const results = targetUnion.map(branch => compareJsonSchemas(produced, branch, depth + 1))
    return results.includes('compatible')
      ? unknown
        ? 'unknown'
        : 'compatible'
      : // Several narrower branches may collectively cover the source; that needs a union solver.
        'unknown'
  }

  const results: ContractCompatibilityStatus[] = [unknown ? 'unknown' : 'compatible']
  // An opaque source may narrow its domain in ways this checker cannot see. Do not infer a
  // counterexample from the broader projected schema; named outputs are checked separately.
  const reject = (): ContractCompatibilityStatus => (unknown ? 'unknown' : 'incompatible')
  const sourceTypes = types(produced)
  const targetTypes = types(accepted)
  if (targetTypes !== undefined) {
    if (sourceTypes === undefined && enumValues(produced) === undefined) results.push(reject())
    else if (
      sourceTypes?.some(
        type =>
          !targetTypes.includes(type) && !(type === 'integer' && targetTypes.includes('number')),
      )
    ) {
      results.push(reject())
    }
  }
  const sourceValues = enumValues(produced)
  const targetValues = enumValues(accepted)
  if (targetValues !== undefined) {
    if (
      sourceValues === undefined ||
      sourceValues.some(value => !targetValues.some(target => same(value, target)))
    )
      results.push(reject())
  }
  if (sourceValues !== undefined && targetTypes !== undefined) {
    if (
      sourceValues.some(
        value =>
          !targetTypes.includes(
            value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
          ) &&
          !(
            typeof value === 'number' &&
            Number.isInteger(value) &&
            targetTypes.includes('integer')
          ),
      )
    )
      results.push(reject())
  }
  if (sourceValues?.some(value => value !== null && typeof value === 'object'))
    results.push('unknown')
  for (const lower of [true, false]) {
    const target = bound(accepted, lower)
    const source = bound(produced, lower)
    if (target !== undefined) {
      if (sourceValues !== undefined) {
        if (
          sourceValues.some(
            value =>
              typeof value === 'number' &&
              (lower
                ? value < target.value || (target.exclusive && value === target.value)
                : value > target.value || (target.exclusive && value === target.value)),
          )
        )
          results.push(reject())
      } else if (
        sourceTypes !== undefined &&
        !sourceTypes.some(type => type === 'number' || type === 'integer')
      ) {
        // JSON Schema numeric keywords have no effect on other value types.
      } else if (
        source === undefined ||
        (lower ? source.value < target.value : source.value > target.value) ||
        (source.value === target.value && target.exclusive && !source.exclusive)
      )
        results.push(reject())
    }
  }
  for (const key of ['minLength', 'minItems'] as const) {
    const limit = accepted[key]
    if (typeof limit !== 'number') continue
    if (sourceValues !== undefined) {
      if (
        sourceValues.some(
          value =>
            (key === 'minLength' ? typeof value === 'string' : Array.isArray(value)) &&
            (value as string | readonly JsonSchemaValue[]).length < limit,
        )
      )
        results.push(reject())
    } else if (
      sourceTypes === undefined ||
      sourceTypes.includes(key === 'minLength' ? 'string' : 'array')
    ) {
      if (typeof produced[key] !== 'number' || produced[key] < limit) results.push(reject())
    }
  }
  for (const key of ['maxLength', 'maxItems'] as const) {
    const limit = accepted[key]
    if (typeof limit !== 'number') continue
    if (sourceValues !== undefined) {
      if (
        sourceValues.some(
          value =>
            (key === 'maxLength' ? typeof value === 'string' : Array.isArray(value)) &&
            (value as string | readonly JsonSchemaValue[]).length > limit,
        )
      )
        results.push(reject())
    } else if (
      sourceTypes === undefined ||
      sourceTypes.includes(key === 'maxLength' ? 'string' : 'array')
    ) {
      if (typeof produced[key] !== 'number' || produced[key] > limit) results.push(reject())
    }
  }
  for (const key of ['pattern', 'format'] as const) {
    if (
      (sourceTypes === undefined || sourceTypes.includes('string')) &&
      accepted[key] !== undefined &&
      !same(produced[key], accepted[key])
    )
      results.push('unknown')
  }

  if (
    sourceTypes?.includes('object') &&
    (targetTypes === undefined || targetTypes.includes('object'))
  ) {
    const sourceProperties = object(produced['properties']) ?? {}
    const targetProperties = object(accepted['properties']) ?? {}
    const sourceRequired = Array.isArray(produced['required']) ? produced['required'] : []
    const targetRequired = Array.isArray(accepted['required']) ? accepted['required'] : []
    if (targetRequired.some(name => !sourceRequired.includes(name))) results.push(reject())
    for (const [name, value] of Object.entries(sourceProperties)) {
      if (Object.hasOwn(targetProperties, name)) {
        results.push(
          compareJsonSchemas(asSchema(value), asSchema(targetProperties[name]), depth + 1),
        )
      } else if (accepted['additionalProperties'] === false) results.push(reject())
      else if (object(accepted['additionalProperties']) !== undefined) {
        results.push(
          compareJsonSchemas(
            asSchema(value),
            asSchema(accepted['additionalProperties']),
            depth + 1,
          ),
        )
      }
    }
    if (produced['additionalProperties'] !== false) {
      if (accepted['additionalProperties'] === false) results.push(reject())
      else if (object(accepted['additionalProperties']) !== undefined)
        results.push(
          compareJsonSchemas(
            asSchema(produced['additionalProperties']) ?? {},
            asSchema(accepted['additionalProperties']),
            depth + 1,
          ),
        )
      for (const [name, value] of Object.entries(targetProperties)) {
        if (!Object.hasOwn(sourceProperties, name))
          results.push(
            compareJsonSchemas(
              asSchema(produced['additionalProperties']) ?? {},
              asSchema(value),
              depth + 1,
            ),
          )
      }
    }
    if (produced['x-mfe-tolerant-input'] === true && accepted['additionalProperties'] === false)
      results.push('unknown')
  } else if (
    sourceTypes === undefined &&
    (accepted['properties'] !== undefined ||
      accepted['required'] !== undefined ||
      accepted['additionalProperties'] !== undefined)
  ) {
    results.push('unknown')
  }
  if (
    sourceTypes?.includes('array') &&
    (targetTypes === undefined || targetTypes.includes('array')) &&
    accepted['items'] !== undefined
  ) {
    results.push(
      compareJsonSchemas(asSchema(produced['items']), asSchema(accepted['items']), depth + 1),
    )
  } else if (sourceTypes === undefined && accepted['items'] !== undefined) {
    results.push('unknown')
  }
  const result = merge(results)
  return unknown && result === 'incompatible' ? 'unknown' : result
}

/** Compare published contracts without downloading either Widget's implementation. */
export function comparePublishedContracts(
  consumer: PublishedContract,
  provider: PublishedContract,
): ContractCompatibility {
  const issues: ContractCompatibilityIssue[] = []
  const add = (
    status: ContractCompatibilityStatus,
    direction: 'input' | 'output',
    path: readonly string[],
    reason: string,
  ): void => {
    if (status !== 'compatible') issues.push({ status, direction, path, reason })
  }
  add(
    compareJsonSchemas(consumer.inputSchema, provider.inputSchema),
    'input',
    [],
    'The provider must accept every input described by the consumer contract.',
  )
  const expected = object(consumer.outputSchema?.['properties'])
  const supplied = object(provider.outputSchema?.['properties'])
  if (expected === undefined || supplied === undefined)
    add('unknown', 'output', [], 'Output names or payload schemas could not be compared.')
  else
    for (const [name, schema] of Object.entries(expected)) {
      if (!Object.hasOwn(supplied, name))
        add(
          'incompatible',
          'output',
          [name],
          `The provider no longer declares expected output '${name}'.`,
        )
      else
        add(
          compareJsonSchemas(asSchema(supplied[name]), asSchema(schema)),
          'output',
          [name],
          `The consumer must accept every payload of output '${name}'.`,
        )
    }
  return { status: merge(issues.map(issue => issue.status)), issues }
}

/**
 * Zod 4's data-only metadata is projected locally instead of importing its JSON Schema converter.
 * This never executes parses, refinements, defaults, lazy factories, or transform callbacks.
 * New/unrecognized Zod metadata is marked opaque, which safely degrades to unknown.
 */
function project(
  schema: unknown,
  io: 'input' | 'output',
  produced: boolean,
  depth = 0,
): JsonSchemaObject {
  const metadata = object(object(schema)?.['_zod'])
  const def = object(metadata?.['def'])
  if (def === undefined || depth > 32) return { 'x-mfe-unknown': true }
  const inner = (value: unknown): JsonSchemaObject => project(value, io, produced, depth + 1)
  const type = def['type']
  let result: JsonSchemaObject
  switch (type) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
      result = { type }
      break
    case 'enum':
      result = { enum: Object.values(object(def['entries']) ?? {}) as JsonSchemaValue[] }
      break
    case 'literal':
      result = { enum: def['values'] as JsonSchemaValue[] }
      break
    case 'object': {
      const shape = object(def['shape']) ?? {}
      const properties: Record<string, JsonSchemaObject> = {}
      const required: string[] = []
      for (const [name, child] of Object.entries(shape)) {
        properties[name] = inner(child)
        const childMetadata = object(object(child)?.['_zod'])
        if (childMetadata?.[io === 'input' ? 'optin' : 'optout'] === undefined) required.push(name)
      }
      const catchall = def['catchall']
      const strict = object(object(object(catchall)?.['_zod'])?.['def'])?.['type'] === 'never'
      result = {
        type: 'object',
        properties,
        required,
        additionalProperties: strict ? false : catchall === undefined ? !produced : inner(catchall),
      }
      // Typed inputs describe declared fields, but a tolerant consumer schema can also permit
      // undeclared raw keys. A strict provider must not be asserted compatible with that case.
      if (produced && io === 'input' && !strict)
        result = { ...result, 'x-mfe-tolerant-input': true }
      break
    }
    case 'array':
      result = { type: 'array', items: inner(def['element']) }
      break
    case 'union':
      result = { anyOf: Array.isArray(def['options']) ? def['options'].map(inner) : [] }
      break
    case 'nullable':
      result = { anyOf: [inner(def['innerType']), { type: 'null' }] }
      break
    case 'optional':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'nonoptional':
      result = inner(def['innerType'])
      break
    case 'unknown':
    case 'any':
      result = {}
      break
    default:
      result = { 'x-mfe-unknown': true }
  }
  const mutable = { ...result }
  const constrain = (key: string, value: unknown, lower: boolean): void => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      mutable['x-mfe-unknown'] = true
      return
    }
    const previous = mutable[key]
    mutable[key] =
      typeof previous === 'number'
        ? lower
          ? Math.max(previous, value)
          : Math.min(previous, value)
        : value
  }
  if (def['coerce'] === true) mutable['x-mfe-unknown'] = true
  const checks = Array.isArray(def['checks']) ? def['checks'] : []
  for (const check of checks) {
    const detail = object(object(object(check)?.['_zod'])?.['def']) ?? {}
    switch (detail['check']) {
      case 'min_length':
        constrain(type === 'array' ? 'minItems' : 'minLength', detail['minimum'], true)
        break
      case 'max_length':
        constrain(type === 'array' ? 'maxItems' : 'maxLength', detail['maximum'], false)
        break
      case 'length_equals':
        constrain(type === 'array' ? 'minItems' : 'minLength', detail['length'], true)
        constrain(type === 'array' ? 'maxItems' : 'maxLength', detail['length'], false)
        break
      case 'greater_than':
        constrain(
          detail['inclusive'] === true ? 'minimum' : 'exclusiveMinimum',
          detail['value'],
          true,
        )
        break
      case 'less_than':
        constrain(
          detail['inclusive'] === true ? 'maximum' : 'exclusiveMaximum',
          detail['value'],
          false,
        )
        break
      case 'number_format':
        if (detail['format'] === 'safeint' || detail['format'] === 'int32') {
          mutable['type'] = 'integer'
          constrain(
            'minimum',
            detail['format'] === 'safeint' ? Number.MIN_SAFE_INTEGER : -2147483648,
            true,
          )
          constrain(
            'maximum',
            detail['format'] === 'safeint' ? Number.MAX_SAFE_INTEGER : 2147483647,
            false,
          )
        } else mutable['x-mfe-unknown'] = true
        break
      // Custom predicates, string formats/regex flags, overwrite, and unfamiliar checks remain opaque.
      default:
        mutable['x-mfe-unknown'] = true
    }
  }
  // Format schemas can be standalone Zod types with their check on the definition itself.
  if (def['check'] !== undefined) mutable['x-mfe-unknown'] = true
  return mutable
}

/**
 * Inputs flow consumer → provider; parsed output payloads flow provider → consumer. A legacy
 * host can provide only its outputSchema; that skips input comparison without inventing input
 * expectations, while still detecting removed events and incompatible payloads before mounting.
 */
export function compareWidgetContracts(
  consumer: Pick<WidgetContract, 'outputSchema'> & Partial<Pick<WidgetContract, 'inputSchema'>>,
  provider: WidgetContract,
): ContractCompatibility {
  return comparePublishedContracts(
    {
      inputSchema:
        consumer.inputSchema === undefined ? {} : project(consumer.inputSchema, 'input', true),
      outputSchema: project(consumer.outputSchema, 'input', false),
    },
    {
      inputSchema:
        consumer.inputSchema === undefined ? {} : project(provider.inputSchema, 'input', false),
      outputSchema: project(provider.outputSchema, 'output', true),
    },
  )
}
