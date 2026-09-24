/**
 * The helper lives in the neutral build package; this subpath keeps the name a React container's
 * `src/mfe.config.ts` imports it by, and like the helper it loads nothing from Node.
 */

export { ENV_NAME_RULE, env, isEnvVarDescriptor } from '@company/mfe-build/env'
export type {
  EnvConfigSource,
  EnvOptions,
  EnvVarDescriptor,
  InferEnvConfig,
} from '@company/mfe-build/env'

// What a host's generated `#mfe/config` checks its values with, in place of Zod.
export { checkConfigField, checkValue } from '@company/mfe-build/env'
export type { ConfigFieldSpec, ConfigSchema, FieldCheck } from '@company/mfe-build/env'
