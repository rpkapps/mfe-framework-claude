/**
 * `mfePlugin()` options. The list is deliberately short: federation names,
 * exposes, share scopes, singleton flags and manifest settings only produce a
 * working page when every container agrees on them, which is not something a
 * per-repository config file can promise, so they are derived instead.
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { createBuildError } from './diagnostics.ts'

export interface MfePluginOptions {
  /**
   * The container root. Defaults to the compiler context, which is the
   * directory holding `rspack.config.ts`.
   */
  readonly containerRoot?: string
  /**
   * The one supported sharing override. It is additive: the adapter's defaults
   * are kept, and there is no way to remove one.
   */
  readonly shared?: Readonly<Record<string, string>>
  /**
   * Turns the supported React Compiler transform off for a build. This exists
   * so a repository can run its test matrix compiled and uncompiled; it is not
   * a place to configure the compiler, which the plugin owns.
   */
  readonly reactCompiler?: boolean
  /**
   * Composes `@tanstack/router-plugin`. Pass `false` when the container's own
   * config already applies it, and apply it before this plugin so the route
   * tree is generated before anything reads the routes directory.
   */
  readonly router?: boolean | Readonly<Record<string, unknown>>
  /** Build-managed output directory, relative to the container root. */
  readonly generatedDir?: string
  /** The App's file-based routes, relative to the container root. */
  readonly routesDirectory?: string
  /** The deployment-provided config file, relative to the container's assets. */
  readonly runtimeConfigFileName?: string
  /** The Module Federation manifest file name. */
  readonly manifestFileName?: string
  /** The shell registry descriptor file name. */
  readonly registryFileName?: string
  /** Federation container name. Defaults to a sanitized package name. */
  readonly name?: string
  /** Fixes the recorded build time. Defaults to now, in ISO 8601. */
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
  readonly routesDirectory: string
  readonly runtimeConfigFileName: string
  readonly manifestFileName: string
  readonly registryFileName: string
  readonly federationName: string
  readonly packageName: string
  readonly packageVersion: string | undefined
  readonly dependencies: Readonly<Record<string, string>>
  readonly sharedOverrides: Readonly<Record<string, string>>
  readonly reactCompiler: boolean
  readonly router: false | Readonly<Record<string, unknown>>
  readonly buildTime: string
}

const DEFAULT_GENERATED_DIR = '.mfe'
const DEFAULT_ROUTES_DIRECTORY = 'src/routes'
const DEFAULT_RUNTIME_CONFIG_FILE = 'runtime-config.json'
const DEFAULT_MANIFEST_FILE = 'mf-manifest.json'
const DEFAULT_REGISTRY_FILE = 'mfe-registry.json'

export function resolveOptions(options: MfePluginOptions, containerRoot: string): ResolvedOptions {
  const root = resolve(options.containerRoot ?? containerRoot)
  const manifest = readManifest(root)

  const packageName = options.name ?? manifest.name ?? 'mfe-container'

  return {
    containerRoot: root,
    generatedDir: absolute(root, options.generatedDir ?? DEFAULT_GENERATED_DIR),
    routesDirectory: absolute(root, options.routesDirectory ?? DEFAULT_ROUTES_DIRECTORY),
    runtimeConfigFileName: options.runtimeConfigFileName ?? DEFAULT_RUNTIME_CONFIG_FILE,
    manifestFileName: options.manifestFileName ?? DEFAULT_MANIFEST_FILE,
    registryFileName: options.registryFileName ?? DEFAULT_REGISTRY_FILE,
    federationName: sanitizeFederationName(packageName),
    packageName: manifest.name ?? packageName,
    packageVersion: manifest.version,
    dependencies: { ...manifest.peerDependencies, ...manifest.dependencies },
    sharedOverrides: options.shared ?? {},
    reactCompiler: options.reactCompiler !== false,
    router:
      options.router === false ? false : options.router === true ? {} : (options.router ?? {}),
    buildTime: options.buildTime ?? new Date().toISOString(),
  }
}

function absolute(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path)
}

/**
 * A Module Federation container name has to be a legal JavaScript identifier,
 * because it also names the global the remote entry installs itself on.
 */
function sanitizeFederationName(packageName: string): string {
  const withoutScope = packageName.startsWith('@') ? packageName.slice(1) : packageName
  const sanitized = withoutScope.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[0-9]/.test(sanitized)
    ? `mfe_${sanitized}`
    : sanitized === ''
      ? 'mfe_container'
      : sanitized
}

function readManifest(root: string): ContainerManifest {
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
      repair:
        'Point mfePlugin({ containerRoot }) at the directory holding the container package.json. The manifest is what the sharing defaults are intersected with.',
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
