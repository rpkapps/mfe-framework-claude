/**
 * The host's runtime configuration, generated the one way the Rsbuild plugin and `mfe-generate
 * --host` both use: the same declarations and deployment files a container has, with a
 * `#mfe/config` that validates without Zod (docs/decisions.md §37).
 */

import {
  planHostConfig,
  writeGeneratedFiles,
  type GeneratedFile,
  type HostConfigPlan,
} from '@company/mfe-build'

export interface HostConfigOptions {
  /** The host's package root; defaults to the working directory. */
  readonly root?: string
  /** The name its configuration errors carry; defaults to the package name without its scope. */
  readonly id?: string
  readonly generatedDir?: string
  readonly runtimeConfigFileName?: string
}

export interface HostConfigGeneration {
  readonly plan: HostConfigPlan
  /** The files whose contents changed. */
  readonly written: readonly GeneratedFile[]
}

export function planReactHostConfig(options: HostConfigOptions = {}): HostConfigPlan | null {
  return planHostConfig({
    root: options.root ?? process.cwd(),
    generator: '@company/mfe-rspack',
    envModules: ['@company/mfe-rspack', '@company/mfe-rspack/env'],
    // The browser-safe subpath: the root export loads the plugin, which needs Node.
    checkModule: '@company/mfe-rspack/env',
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.generatedDir === undefined ? {} : { generatedDir: options.generatedDir }),
    ...(options.runtimeConfigFileName === undefined
      ? {}
      : { runtimeConfigFileName: options.runtimeConfigFileName }),
  })
}

/** Re-reads the declarations and rewrites what changed; `null` when the host declares none. */
export function generateHostConfig(options: HostConfigOptions = {}): HostConfigGeneration | null {
  const plan = planReactHostConfig(options)
  if (plan === null) return null
  return { plan, written: writeGeneratedFiles(plan.files) }
}
