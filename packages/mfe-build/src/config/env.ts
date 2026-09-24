/** The one part of the package also evaluated in the browser, so it imports nothing from Node. */

import { createMfeError } from '@company/mfe-core'
import type { z } from 'zod'

/** Environment variable names are screaming snake case, as in a shell. */
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/

export const ENV_NAME_RULE =
  'upper-case letters, digits and single underscores (for example "API_BASE_URL")'

export interface EnvOptions {
  /** Adds the origin to the allowlist `#mfe/fetch` is bound to; undeclared origins get no token. */
  readonly api?: boolean
}

/** A declaration, never a value; `kind` is a string so the descriptor survives cloning. */
export interface EnvVarDescriptor<T = unknown> {
  readonly kind: 'mfe-env-var'
  /** The environment variable the deployment sets. */
  readonly name: string
  /** The author's own Zod schema; validation runs through its `safeParse`. */
  readonly schema: z.ZodType<T>
  /** True when `{ api: true }` declared this value as an API origin. */
  readonly api: boolean
}

/** The shape of `src/mfe.config.ts`'s default export. */
export type EnvConfigSource = Readonly<Record<string, EnvVarDescriptor>>

/** Derived from the descriptors, so the runtime type and the schema cannot drift apart. */
export type InferEnvConfig<D> = {
  readonly [K in keyof D]: D[K] extends EnvVarDescriptor<infer T> ? T : never
}

/** Declares one configuration field; a `.default()` in the schema applies when it is omitted. */
export function env<T>(
  name: string,
  schema: z.ZodType<T>,
  options: EnvOptions = {},
): EnvVarDescriptor<T> {
  if (typeof name !== 'string' || !ENV_NAME_PATTERN.test(name)) {
    throw createMfeError({
      code: 'config/invalid',
      id: typeof name === 'string' && name !== '' ? name : '<missing>',
      operation: 'declare a configuration field',
      expected: ENV_NAME_RULE,
      observed: typeof name === 'string' ? JSON.stringify(name) : `a ${typeof name}`,
      repair:
        'Rename the variable. The same name appears in the generated .env.example and in runtime-config.json, so it has to be writable in a shell.',
    })
  }

  if (schema === null || typeof schema !== 'object' || typeof schema.safeParse !== 'function') {
    throw createMfeError({
      code: 'config/invalid',
      id: name,
      operation: 'declare a configuration field',
      expected: 'a Zod schema',
      observed: schema === undefined ? 'nothing' : `a ${typeof schema}`,
      repair: `Pass a schema, for example env('${name}', z.string().url()). The build reads it to emit the JSON Schema for runtime-config.json, and the runtime validates against it.`,
    })
  }

  return {
    kind: 'mfe-env-var',
    name,
    schema,
    api: options.api === true,
  }
}

export function isEnvVarDescriptor(value: unknown): value is EnvVarDescriptor {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'mfe-env-var' &&
    typeof (value as { name?: unknown }).name === 'string'
  )
}

// The Zod-free check a host's generated `#mfe/config` runs; it lives here because this is the one
// part of the package evaluated in the browser.
export { checkConfigField, checkValue } from './check.ts'
export type { ConfigFieldSpec, ConfigSchema, FieldCheck, StringTransform } from './check.ts'
