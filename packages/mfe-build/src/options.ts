/** The list is short because a setting every container must agree on is derived, not declared. */

import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { createBuildError } from './diagnostics.ts'

/** The options every integration takes; each adds its own framework's beside them. */
export interface ContainerOptions {
  /** Defaults to the directory the integration runs in. */
  readonly containerRoot?: string
  /** Additive: the adapter's defaults are kept, and there is no way to remove one. */
  readonly shared?: Readonly<Record<string, string>>
  /** Build-managed output directory, relative to the container root. */
  readonly generatedDir?: string
  /** The deployment-provided config file, relative to the container's assets. */
  readonly runtimeConfigFileName?: string
  readonly manifestFileName?: string
  /** The file name the container's registry entry is written to. */
  readonly registryFileName?: string
  /** Federation container name; defaults to a sanitized package name. */
  readonly name?: string
  /** Fixes the recorded build time; defaults to now, in ISO 8601. */
  readonly buildTime?: string
}

interface ContainerManifest {
  readonly name?: string
  readonly version?: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

export interface ResolvedOptions {
  readonly containerRoot: string
  readonly generatedDir: string
  readonly runtimeConfigFileName: string
  readonly manifestFileName: string
  readonly registryFileName: string
  readonly federationName: string
  readonly packageName: string
  readonly packageVersion: string | undefined
  readonly dependencies: Readonly<Record<string, string>>
  readonly sharedOverrides: Readonly<Record<string, string>>
  readonly buildTime: string
  /** A fixed time is recorded as given; otherwise an unchanged shape keeps its time (§19). */
  readonly buildTimeFixed: boolean
}

const DEFAULT_GENERATED_DIR = '.mfe'
const DEFAULT_RUNTIME_CONFIG_FILE = 'runtime-config.json'
const DEFAULT_MANIFEST_FILE = 'mf-manifest.json'
const DEFAULT_REGISTRY_FILE = 'mfe-registry.json'

/** `containerRootOption` is how the author names the root, for the repair when it is wrong. */
export function resolveOptions(
  options: ContainerOptions,
  containerRootOption: string,
): ResolvedOptions {
  const root = resolve(options.containerRoot ?? process.cwd())
  const manifest = readManifest(root, containerRootOption)

  const packageName = options.name ?? manifest.name ?? 'mfe-container'

  return {
    containerRoot: root,
    generatedDir: generatedDirOf(root, options),
    runtimeConfigFileName: runtimeConfigFileNameOf(options),
    manifestFileName: options.manifestFileName ?? DEFAULT_MANIFEST_FILE,
    registryFileName: options.registryFileName ?? DEFAULT_REGISTRY_FILE,
    federationName: sanitizeFederationName(packageName),
    packageName: manifest.name ?? packageName,
    packageVersion: manifest.version,
    dependencies: { ...manifest.peerDependencies, ...manifest.dependencies },
    sharedOverrides: options.shared ?? {},
    buildTime: options.buildTime ?? new Date().toISOString(),
    buildTimeFixed: options.buildTime !== undefined,
  }
}

/** A path an author gives relative to the container root, or absolute. */
export function resolveContainerPath(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path)
}

/** The options that say where a container's local runtime configuration is. */
export type LocalRuntimeConfigOptions = Pick<
  ContainerOptions,
  'generatedDir' | 'runtimeConfigFileName'
> & { readonly containerRoot: string }

/**
 * The developer's own runtime configuration, with values such as a localhost API. It lives in the
 * build-managed directory because no bundler copies that directory into a build's output, so a
 * local value cannot ship whatever the file is named.
 */
export function localRuntimeConfigPath(options: LocalRuntimeConfigOptions): string {
  return join(
    generatedDirOf(resolve(options.containerRoot), options),
    runtimeConfigFileNameOf(options),
  )
}

function generatedDirOf(root: string, options: Pick<ContainerOptions, 'generatedDir'>): string {
  return resolveContainerPath(root, options.generatedDir ?? DEFAULT_GENERATED_DIR)
}

/** The name the runtime configuration is published under, beside the container's assets. */
export function runtimeConfigFileNameOf(
  options: Pick<ContainerOptions, 'runtimeConfigFileName'>,
): string {
  return options.runtimeConfigFileName ?? DEFAULT_RUNTIME_CONFIG_FILE
}

/** It also names the global the remote entry installs itself on, so it must be an identifier. */
function sanitizeFederationName(packageName: string): string {
  const withoutScope = packageName.startsWith('@') ? packageName.slice(1) : packageName
  const sanitized = withoutScope.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[0-9]/.test(sanitized)
    ? `mfe_${sanitized}`
    : sanitized === ''
      ? 'mfe_container'
      : sanitized
}

function readManifest(root: string, containerRootOption: string): ContainerManifest {
  const file = join(root, 'package.json')
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (cause) {
    throw createBuildError({
      file,
      operation: "read the container's package manifest",
      expected: 'a package.json at the container root',
      observed: 'no readable file',
      declaredBy: 'The build plugin',
      repair: `Point ${containerRootOption} at the directory holding the container package.json. The manifest is what the sharing defaults are intersected with.`,
      cause,
    })
  }

  try {
    return JSON.parse(text) as ContainerManifest
  } catch (cause) {
    throw createBuildError({
      file,
      operation: "read the container's package manifest",
      expected: 'valid JSON',
      observed: cause instanceof Error ? cause.message : 'a parse failure',
      declaredBy: 'The build plugin',
      repair: 'Fix the syntax error in package.json and rebuild.',
      cause,
    })
  }
}
