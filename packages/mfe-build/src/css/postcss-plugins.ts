/**
 * Tailwind, or the plain CSS imports inlined, before the scope plugin: scoping before the rules
 * exist would scope nothing.
 */

import { createRequire } from 'node:module'

import type { AcceptedPlugin } from 'postcss'

import { containerScopePlugin, type ScopePluginLoader } from './scope.ts'

const require = createRequire(import.meta.url)

export interface ContainerPostcssOptions {
  /** The `data-mfe-scope` values this container's CSS is scoped to. */
  readonly scopes: readonly string[]
  /** Where the scope plugin is resolved from, so the container's copy wins. */
  readonly containerRoot: string
  /** Which plugin scopes the stylesheet, such as a design system's own or `scopeFallbackPlugin`. */
  readonly loadScopePlugin: ScopePluginLoader
  /** The plan's `tailwind`: false inlines the stylesheet's CSS imports instead. Default true. */
  readonly tailwind?: boolean
  /** What the container's own PostCSS config already contributes, if anything. */
  readonly configured?: unknown
}

/** The plugins to append, in order, to whatever the container already has. */
export function containerPostcssPlugins(options: ContainerPostcssOptions): AcceptedPlugin[] {
  const plugins: AcceptedPlugin[] = []

  if (options.tailwind === false) plugins.push(...cssImportPlugins())
  else if (!declaresTailwind(options.configured)) plugins.push(tailwindPlugin())
  plugins.push(
    containerScopePlugin({
      scopes: options.scopes,
      containerRoot: options.containerRoot,
      loadScopePlugin: options.loadScopePlugin,
    }),
  )

  return plugins
}

/**
 * Without Tailwind, nothing else inlines the stylesheet's imports, and the scope plugin has to see
 * every rule. An inlined file's relative `url()` still names a path from its own directory, which
 * the bundler would resolve from the generated stylesheet's instead, so each is rebased onto it.
 */
function cssImportPlugins(): AcceptedPlugin[] {
  const inline = require('postcss-import') as () => AcceptedPlugin
  const url = require('postcss-url') as (options: { url: 'rebase' }) => AcceptedPlugin
  return [inline(), url({ url: 'rebase' })]
}

/** Loaded through `require` because it is this package's dependency, not the container's. */
function tailwindPlugin(): AcceptedPlugin {
  const exported: unknown = require('@tailwindcss/postcss')
  const factory = (
    typeof exported === 'function' ? exported : (exported as { default?: unknown }).default
  ) as () => AcceptedPlugin

  return factory()
}

/** A config contributes already-constructed plugins, so the name each announces identifies it. */
function declaresTailwind(configured: unknown): boolean {
  if (typeof configured !== 'object' || configured === null) return false

  const { plugins } = configured as { plugins?: unknown }
  if (!Array.isArray(plugins)) return false

  return plugins.some(plugin => {
    const name =
      typeof plugin === 'object' && plugin !== null
        ? (plugin as { postcssPlugin?: unknown }).postcssPlugin
        : undefined
    return typeof name === 'string' && name.includes('tailwindcss')
  })
}
