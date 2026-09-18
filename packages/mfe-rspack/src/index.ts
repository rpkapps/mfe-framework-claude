/**
 * `@company/mfe-rspack` — the build side of the MFE framework.
 *
 * Two things are public: `pluginMfe()`, the Rsbuild plugin a container's config
 * adds, and `env()`, used in `src/mfe.config.ts` to declare what the deployment
 * provides. The package is side-effect free so importing `env` never drags the
 * plugin, the TypeScript compiler API or PostCSS into a browser bundle.
 */

export { pluginMfe } from './rsbuild.ts'
export type { MfePluginOptions } from './options.ts'

export { env } from './config/env.ts'
export type { EnvOptions, EnvVarDescriptor, InferEnvConfig } from './config/env.ts'
