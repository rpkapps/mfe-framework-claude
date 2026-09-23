/**
 * The framework supplies the selectors and the integration picks the plugin that scopes with them:
 * a design system's own recipe, or the built-in fallback.
 */

import { join } from 'node:path'

import { SCOPE_ATTRIBUTE } from '@company/mfe-core'
import type { Plugin } from 'postcss'

import { createBuildError } from '../diagnostics.ts'

/** What every scope plugin is given, so a design system's and the fallback are interchangeable. */
export interface ScopeOptions {
  /** The selector list of the mount roots this stylesheet belongs to. */
  readonly scope: string
  /** Where the scope ends: any mount root below, which belongs to another definition. */
  readonly boundary: string
  /** Appended to every keyframes name the stylesheet defines; a name is global to the page. */
  readonly keyframes: { readonly suffix: string }
}

/** Typed with this package's PostCSS, so a plugin found at run time needs no types of its own. */
export type ScopePluginFactory = (options: ScopeOptions) => Plugin

/**
 * Finds the plugin for one container. It is only asked once the container is known to have
 * something to scope, so a loader that fails reports after the more basic mistake.
 */
export type ScopePluginLoader = (containerRoot: string) => ScopePluginFactory

export interface ContainerScopeOptions {
  /** The definition ids this container's CSS is scoped to. */
  readonly scopes: readonly string[]
  /** The container root, handed to the loader so the container's own copy can win. */
  readonly containerRoot: string
  readonly loadScopePlugin: ScopePluginLoader
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

  return options.loadScopePlugin(options.containerRoot)({
    scope: scopes.map(id => `[${SCOPE_ATTRIBUTE}="${id}"]`).join(', '),
    boundary: `[${SCOPE_ATTRIBUTE}]`,
    keyframes: { suffix: scopes.join('-') },
  })
}
