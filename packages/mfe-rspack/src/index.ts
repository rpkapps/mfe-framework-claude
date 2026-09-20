/**
 * `@company/mfe-rspack` — the build side of the MFE framework.
 *
 * Two things are public here: `pluginMfe()`, the Rsbuild plugin a container's
 * config adds, and `env()`, used in `src/mfe.config.ts` to declare what the
 * deployment provides. The package is side-effect free so importing `env`
 * never drags the plugin, the TypeScript compiler API or PostCSS into a
 * browser bundle, and `@company/mfe-rspack/env` is the import that does not
 * rely on a bundler to prove it.
 *
 * A federation *host* builds nothing from this barrel. What it needs — the
 * share scope a container's build derives for itself — is the third and last
 * public entry, `@company/mfe-rspack/federation`, on its own subpath for the
 * same reason `env` has one: a host's config has no use for the plugin, the
 * compiler API or PostCSS and should not load them to read one map.
 */

export { pluginMfe } from './rsbuild.ts'
export type { MfePluginOptions } from './options.ts'

export { env } from './config/env.ts'
export type { EnvOptions, EnvVarDescriptor, InferEnvConfig } from './config/env.ts'
