/**
 * The PostCSS pipeline a container compiles its stylesheet with: Tailwind, then
 * the scope wrapper over what Tailwind emitted. The order is the whole point —
 * scoping a stylesheet before its utilities exist would scope nothing.
 *
 * Tailwind is added by the plugin rather than left to the container, because
 * the stylesheet is the plugin's too: an author never writes the entry that
 * imports Tailwind's theme and utilities, so nothing in the project would tell
 * the build to expand it. A container that declares `@tailwindcss/postcss` in
 * its own PostCSS config keeps that one, with the options it configured, and
 * only gets the scope plugin appended after it.
 */

import { createRequire } from 'node:module'

import type { AcceptedPlugin } from 'postcss'

import { scopedCssPlugin } from './scope-transform.ts'

const require = createRequire(import.meta.url)

export interface ContainerPostcssOptions {
  /** The `data-mfe-scope` values this container's CSS is scoped to. */
  readonly scopes: readonly string[]
  /** What the container's own PostCSS config already contributes, if anything. */
  readonly configured?: unknown
}

/** The plugins to append, in order, to whatever the container already has. */
export function containerPostcssPlugins(options: ContainerPostcssOptions): AcceptedPlugin[] {
  const plugins: AcceptedPlugin[] = []

  if (!declaresTailwind(options.configured)) plugins.push(tailwindPlugin())
  plugins.push(scopedCssPlugin({ scope: options.scopes }))

  return plugins
}

/**
 * Loaded through `require` on purpose: this is a dependency of the build
 * plugin, not of the container, so it resolves the same way whether the
 * container installed Tailwind or not.
 */
function tailwindPlugin(): AcceptedPlugin {
  const exported: unknown = require('@tailwindcss/postcss')
  const factory = (
    typeof exported === 'function' ? exported : (exported as { default?: unknown }).default
  ) as () => AcceptedPlugin

  return factory()
}

/**
 * PostCSS config files are loaded before a plugin is asked to extend them, and
 * what they contribute is already-constructed plugins, so the name each one
 * announces is what identifies it.
 */
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
