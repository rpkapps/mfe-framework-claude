/**
 * The framework supplies the selectors; the design system's own plugin does the scoping when it
 * is installed, and a built-in one with the same recipe when it is not (§17).
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'

import type { Plugin } from 'postcss'

import { createBuildError } from '../diagnostics.ts'
import { scopeFallbackPlugin, type ScopeOptions } from './scope-fallback.ts'

/**
 * Spelled against this package's PostCSS rather than imported from the design system, which is an
 * optional peer and resolves to nothing where it was not installed.
 */
type ScopePluginFactory = (options: ScopeOptions) => Plugin

/** The attribute a mount root carries, and the scope its CSS belongs to. */
const SCOPE_ATTRIBUTE = 'data-mfe-scope'

const SCOPE_PLUGIN = '@tecton/react/postcss/scope'

const ownRequire = createRequire(import.meta.url)

export interface ContainerScopeOptions {
  /** The definition ids this container's CSS is scoped to. */
  readonly scopes: readonly string[]
  /** The container root, whose copy of the design system does the scoping. */
  readonly containerRoot: string
}

/** The scope plugin for one container; it runs after `@tailwindcss/postcss` (§17). */
export function containerScopePlugin(options: ContainerScopeOptions): Plugin {
  const scopes = [...options.scopes]
  if (scopes.length === 0) {
    throw createBuildError({
      file: join(options.containerRoot, 'src/mfe.ts'),
      operation: 'scope this container stylesheet',
      expected: 'at least one definition id to scope to',
      observed: 'an empty scope list',
      declaredBy: 'The container stylesheet scope',
      repair:
        'Export the definitions this container provides. Their ids are the values the mount roots carry in their data-mfe-scope attribute, and the stylesheet is scoped to them.',
    })
  }

  return loadScopePlugin(options.containerRoot)({
    scope: scopes.map(id => `[${SCOPE_ATTRIBUTE}="${id}"]`).join(', '),
    boundary: `[${SCOPE_ATTRIBUTE}]`,
    keyframes: { suffix: scopes.join('-') },
  })
}

/**
 * Resolved from the container root first, so a container on an older design system is scoped by
 * that version's recipe; a build with no copy of it at all, such as an Angular container's, is
 * scoped by the built-in plugin.
 */
function loadScopePlugin(containerRoot: string): ScopePluginFactory {
  for (const resolve of [createRequire(join(containerRoot, 'package.json')), ownRequire]) {
    let exported: unknown
    try {
      exported = resolve(SCOPE_PLUGIN)
    } catch (error) {
      // Not installed here, so the next resolution says whether it is anywhere; a copy that is
      // installed but fails to load is reported rather than silently replaced.
      if ((error as { code?: unknown }).code === 'MODULE_NOT_FOUND') continue
      throw error
    }

    // `require` of an ES module hands back the namespace object, so the plugin is its default.
    return (
      typeof exported === 'function' ? exported : (exported as { default?: unknown }).default
    ) as ScopePluginFactory
  }

  return scopeFallbackPlugin
}
