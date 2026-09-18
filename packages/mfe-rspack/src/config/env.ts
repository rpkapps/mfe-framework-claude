/**
 * `env()` — how an author declares that a value comes from the deployment.
 *
 * `src/mfe.config.ts` names environment variables and the schema each one has
 * to satisfy. It carries no deployment values and no secrets: the values arrive
 * at runtime in `runtime-config.json`, which the generated `#mfe/config` module
 * loads, validates and freezes once per deployed container.
 *
 * ```ts
 * import { env } from '@company/mfe-rspack'
 * import { z } from 'zod'
 *
 * export default {
 *   apiBaseUrl: env('API_BASE_URL', z.string().url(), { api: true }),
 *   oidcIssuer: env('OIDC_ISSUER', z.string().url()),
 * }
 * ```
 *
 * This module is the one part of the package that is also evaluated in the
 * browser, because the generated config module imports the author's config to
 * reach the real schemas. It therefore imports nothing from Node, from Rspack
 * or from the TypeScript compiler, and the package is marked side-effect free
 * so the rest of the plugin never reaches a bundle.
 */

import { createMfeError, type ContractSchema, type InferContract } from '@company/mfe-core'

/** Environment variable names are screaming snake case, as in a shell. */
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/

export const ENV_NAME_RULE =
  'upper-case letters, digits and single underscores (for example "API_BASE_URL")'

export interface EnvOptions {
  /**
   * Marks the value as an API origin this container calls. Every declared
   * origin is added to the allowlist the authenticated `fetch` from
   * `#mfe/fetch` is bound to; an undeclared origin never receives a token.
   */
  readonly api?: boolean
}

/**
 * What `env()` returns: a declaration, never a value. `kind` is a plain string
 * rather than a symbol so the descriptor survives structured cloning and reads
 * clearly in a debugger.
 */
export interface EnvVarDescriptor<T = unknown> {
  readonly kind: 'mfe-env-var'
  /** The environment variable the deployment sets. */
  readonly name: string
  /** The author's own Zod schema. Validation runs through its `safeParse`. */
  readonly schema: ContractSchema<T>
  /** True when `{ api: true }` declared this value as an API origin. */
  readonly api: boolean
}

/** The shape of `src/mfe.config.ts`'s default export. */
export type EnvConfigSource = Readonly<Record<string, EnvVarDescriptor>>

/**
 * The validated configuration a container receives, derived from the
 * descriptors so the runtime type and the schema can never drift apart. The
 * generated `#mfe/config` module exports its config typed with this.
 */
export type InferEnvConfig<D> = {
  readonly [K in keyof D]: D[K] extends EnvVarDescriptor<infer T> ? T : never
}

/**
 * Declares one configuration field.
 *
 * @param name   the environment variable the deployment sets
 * @param schema the author's Zod schema; defaults declared with `.default()`
 *               apply when the deployment omits the field
 */
export function env<S extends ContractSchema<unknown>>(
  name: string,
  schema: S,
  options: EnvOptions = {},
): EnvVarDescriptor<InferContract<S>> {
  if (typeof name !== 'string' || !ENV_NAME_PATTERN.test(name)) {
    throw createMfeError({
      code: 'config/invalid',
      id: typeof name === 'string' && name !== '' ? name : '<missing>',
      operation: 'declare a configuration field',
      expected: ENV_NAME_RULE,
      observed: typeof name === 'string' ? JSON.stringify(name) : `a ${typeof name}`,
      declaredBy: 'The env() declaration contract',
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
      declaredBy: 'The env() declaration contract',
      repair: `Pass a schema, for example env('${name}', z.string().url()). The build reads it to emit the JSON Schema for runtime-config.json, and the runtime validates against it.`,
    })
  }

  return {
    kind: 'mfe-env-var',
    name,
    schema: schema as ContractSchema<InferContract<S>>,
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
