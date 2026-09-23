/**
 * A small, adapter-agnostic preset for anything that consumes a mounted MFE rather than being one:
 * a shell, a cross-adapter test harness, or any other application. It forbids `@company/mfe-core`
 * and `@company/mfe-runtime` (and their subpaths), the same ban both author presets already carry
 * for a container, so a shell config can turn it on directly instead of duplicating it.
 *
 * Framework-neutral: it takes no plugin beyond typescript-eslint's, so it needs no optional peer.
 */

import type { Linter } from 'eslint'
import { TS_FILES, typeScriptPlugins } from './shared.ts'
import {
  applicationBoundaryPaths,
  deepImportPattern,
  MODULE_FEDERATION_PATTERN,
  restrictedImports,
  type RestrictedPath,
  type RestrictedPattern,
} from './restricted-imports.ts'

export interface ApplicationPresetOptions {
  /**
   * The adapter(s) this application is built against, so the message names the right module —
   * a shell or a single-framework container passes one; a cross-adapter test harness passes every
   * adapter it hosts.
   */
  readonly adapterModules: readonly string[]
  /** Defaults to every TypeScript file; this preset assumes another one already sets up the parser. */
  readonly files?: readonly string[] | undefined
  readonly extraRestrictedPaths?: readonly RestrictedPath[] | undefined
  readonly extraRestrictedPatterns?: readonly RestrictedPattern[] | undefined
}

export function application(options: ApplicationPresetOptions): Linter.Config[] {
  const files = options.files ?? TS_FILES
  const extraPaths: readonly RestrictedPath[] = options.extraRestrictedPaths ?? []
  const extraPatterns: readonly RestrictedPattern[] = options.extraRestrictedPatterns ?? []

  return [
    {
      name: 'mfe/application/boundaries',
      files: [...files],
      plugins: typeScriptPlugins,
      rules: {
        '@typescript-eslint/no-restricted-imports': restrictedImports(
          [...applicationBoundaryPaths(options.adapterModules), ...extraPaths],
          [deepImportPattern(options.adapterModules), MODULE_FEDERATION_PATTERN, ...extraPatterns],
        ),
      },
    },
  ]
}
