/**
 * Checks one runtime-configuration value against the JSON Schema the build derived from its Zod
 * declaration, without Zod. A host's `#mfe/config` uses it, because a host reads its configuration
 * before anything else loads and cannot afford to ship Zod for it; a container's still validates
 * through the author's schema. Evaluated in the browser, so it imports nothing at all.
 *
 * It covers exactly what the build can read (`zod-static.ts`): types, literals and enums, the
 * string formats, bounds, patterns, arrays, objects, nullable, optional, default, coercion and the
 * string transforms. Anything else the build refuses, so it never reaches here.
 */

export type ConfigSchema = Readonly<Record<string, unknown>>

export type StringTransform = 'trim' | 'toLowerCase' | 'toUpperCase'

export interface ConfigFieldSpec {
  readonly field: string
  readonly envVar: string
  /** What the declaration accepts, in words, for the error. */
  readonly expected: string
  readonly schema: ConfigSchema
  readonly optional: boolean
  readonly hasDefault: boolean
  readonly defaultValue?: unknown
  readonly transforms?: readonly StringTransform[]
  /** `z.coerce.string()`, `.number()` or `.boolean()`: converts as Zod does before checking. */
  readonly coerce?: 'string' | 'number' | 'boolean'
}

export type FieldCheck =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly problem: string }

function show(value: unknown): string {
  if (value === undefined) return 'nothing'
  const json = JSON.stringify(value) as string | undefined
  return json ?? `a ${typeof value}`
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const FORMATS: Readonly<Record<string, (value: string) => boolean>> = {
  uri: value => {
    try {
      return new URL(value).protocol !== ''
    } catch {
      return false
    }
  },
  email: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  uuid: value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  ulid: value => /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value),
  cuid: value => /^c[a-z0-9]{8,}$/i.test(value),
  ipv4: value =>
    /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(value),
  ipv6: value => {
    if (!value.includes(':')) return false
    try {
      return new URL(`http://[${value}]/`).hostname !== ''
    } catch {
      return false
    }
  },
  'date-time': value =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value)),
  date: value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)),
  time: value => /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value),
  duration: value =>
    /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/.test(value),
}

function number(schema: ConfigSchema, key: string): number | undefined {
  const value = schema[key]
  return typeof value === 'number' ? value : undefined
}

function checkString(schema: ConfigSchema, value: string, at: string): string | null {
  const min = number(schema, 'minLength')
  const max = number(schema, 'maxLength')
  if (min !== undefined && value.length < min) return `${at} is shorter than ${String(min)}`
  if (max !== undefined && value.length > max) return `${at} is longer than ${String(max)}`
  const pattern = schema['pattern']
  if (typeof pattern === 'string' && !new RegExp(pattern).test(value)) {
    return `${at} does not match /${pattern}/`
  }
  const format = schema['format']
  if (typeof format === 'string') {
    const valid = FORMATS[format]
    if (valid !== undefined && !valid(value)) return `${at} ${show(value)} is not a valid ${format}`
  }
  return null
}

function checkNumber(schema: ConfigSchema, value: number, at: string): string | null {
  if (!Number.isFinite(value)) return `${at} is not a finite number`
  if (schema['type'] === 'integer' && !Number.isInteger(value)) return `${at} is not an integer`
  const bounds: readonly [string, (bound: number) => boolean, string][] = [
    ['minimum', bound => value >= bound, 'at least'],
    ['maximum', bound => value <= bound, 'at most'],
    ['exclusiveMinimum', bound => value > bound, 'greater than'],
    ['exclusiveMaximum', bound => value < bound, 'less than'],
  ]
  for (const [key, holds, words] of bounds) {
    const bound = number(schema, key)
    if (bound !== undefined && !holds(bound))
      return `${at} is ${String(value)}, not ${words} ${String(bound)}`
  }
  return null
}

function checkArray(schema: ConfigSchema, value: readonly unknown[], at: string): string | null {
  const min = number(schema, 'minItems')
  const max = number(schema, 'maxItems')
  if (min !== undefined && value.length < min) return `${at} has fewer than ${String(min)} items`
  if (max !== undefined && value.length > max) return `${at} has more than ${String(max)} items`
  const items = schema['items']
  if (items === undefined || items === null || typeof items !== 'object') return null
  for (const [index, item] of value.entries()) {
    const problem = checkValue(items as ConfigSchema, item, `${at}[${String(index)}]`)
    if (problem !== null) return problem
  }
  return null
}

function checkObject(
  schema: ConfigSchema,
  value: Readonly<Record<string, unknown>>,
  at: string,
): string | null {
  const properties = (schema['properties'] ?? {}) as Readonly<Record<string, ConfigSchema>>
  const required = Array.isArray(schema['required']) ? (schema['required'] as string[]) : []
  for (const name of required) {
    if (value[name] === undefined) return `${at}.${name} is missing`
  }
  for (const [name, item] of Object.entries(value)) {
    const property = properties[name]
    if (property === undefined) {
      if (schema['additionalProperties'] === false) return `${at}.${name} is not a known field`
      continue
    }
    const problem = checkValue(property, item, `${at}.${name}`)
    if (problem !== null) return problem
  }
  return null
}

/** The first thing wrong with `value`, or null when the schema accepts it. */
export function checkValue(schema: ConfigSchema, value: unknown, at: string): string | null {
  const anyOf = schema['anyOf']
  if (Array.isArray(anyOf)) {
    const problems = (anyOf as ConfigSchema[]).map(branch => checkValue(branch, value, at))
    if (problems.includes(null)) return null
    return problems.find(problem => problem !== null) ?? `${at} matches no allowed form`
  }
  if ('const' in schema && !sameJson(schema['const'], value)) {
    return `${at} is ${show(value)}, not ${show(schema['const'])}`
  }
  const members = schema['enum']
  if (Array.isArray(members) && !members.some(member => sameJson(member, value))) {
    return `${at} is ${show(value)}, not one of ${members.map(show).join(', ')}`
  }

  switch (schema['type']) {
    case 'null':
      return value === null ? null : `${at} is ${show(value)}, not null`
    case 'boolean':
      return typeof value === 'boolean' ? null : `${at} is ${show(value)}, not a boolean`
    case 'string':
      return typeof value === 'string'
        ? checkString(schema, value, at)
        : `${at} is ${show(value)}, not a string`
    case 'number':
    case 'integer':
      return typeof value === 'number'
        ? checkNumber(schema, value, at)
        : `${at} is ${show(value)}, not a number`
    case 'array':
      return Array.isArray(value)
        ? checkArray(schema, value, at)
        : `${at} is ${show(value)}, not an array`
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? checkObject(schema, value as Record<string, unknown>, at)
        : `${at} is ${show(value)}, not an object`
    default:
      return null
  }
}

/** Zod's own conversions, so a coerced field accepts what it would. */
function coerced(kind: 'string' | 'number' | 'boolean', value: unknown): unknown {
  if (kind === 'string') return String(value)
  if (kind === 'number') return Number(value)
  return Boolean(value)
}

/**
 * The value a field resolves to, or what is wrong with it: a default fills an omitted field, an
 * optional one may stay omitted, and a present value is converted and transformed as the Zod
 * declaration would, then checked.
 */
export function checkConfigField(spec: ConfigFieldSpec, raw: unknown): FieldCheck {
  if (raw === undefined) {
    if (spec.hasDefault) return { ok: true, value: spec.defaultValue }
    if (spec.optional) return { ok: true, value: undefined }
    // Zod converts even an omitted value: `z.coerce.boolean()` reads one as false.
    if (spec.coerce === undefined) {
      return { ok: false, problem: `nothing, and ${spec.field} is required` }
    }
  }

  let value = spec.coerce === undefined ? raw : coerced(spec.coerce, raw)
  if (typeof value === 'string') {
    for (const transform of spec.transforms ?? []) {
      value = transform === 'trim' ? (value as string).trim() : (value as string)[transform]()
    }
  }

  const problem = checkValue(spec.schema, value, spec.field)
  return problem === null ? { ok: true, value } : { ok: false, problem }
}
