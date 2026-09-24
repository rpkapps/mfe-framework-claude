/** `env` and `federation` are subpaths so a config needing one never loads the plugin (§27). */

export { pluginMfe } from './rsbuild.ts'
export { pluginMfeHostConfig } from './host-config.ts'
export type { HostConfigOptions } from './host-config.ts'
export type { MfePluginOptions } from './options.ts'

export { env } from './config/env.ts'
export type { EnvOptions, EnvVarDescriptor, InferEnvConfig } from './config/env.ts'
