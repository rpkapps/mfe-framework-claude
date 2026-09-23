/**
 * `@company/mfe-nx/env`: the name an Angular container's `src/mfe.config.ts` imports `env` by.
 * The helper lives in the neutral build package, and like it this module loads nothing from Node,
 * because the container's generated configuration module bundles it for the browser.
 */

export { ENV_NAME_RULE, env, isEnvVarDescriptor } from '@company/mfe-build/env'
export type {
  EnvConfigSource,
  EnvOptions,
  EnvVarDescriptor,
  InferEnvConfig,
} from '@company/mfe-build/env'
