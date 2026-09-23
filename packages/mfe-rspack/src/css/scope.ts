/** The framework supplies the selectors; the design system's own plugin does the scoping (§17). */

import { createRequire } from 'node:module'
import { join } from 'node:path'

import type { ScopeTectonOptions } from '@tecton/react/postcss/scope'
import type { Plugin } from 'postcss'

import { createBuildError } from '../diagnostics.ts'

/**
 * The return type is spelled against this package's PostCSS because it is an optional peer of
 * the design system, whose own declaration resolves to nothing where it was not installed.
 */
type ScopeTecton = (options: ScopeTectonOptions) => Plugin

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
 * that version's recipe; the fallback scopes a container that does not depend on it at all.
 */
function loadScopePlugin(containerRoot: string): ScopeTecton {
  for (const resolve of [createRequire(join(containerRoot, 'package.json')), ownRequire]) {
    let exported: unknown
    try {
      exported = resolve(SCOPE_PLUGIN)
    } catch {
      // Not installed here; the next resolution says whether it is anywhere.
      continue
    }

    // `require` of an ES module hands back the namespace object, so the plugin is its default.
    return (
      typeof exported === 'function' ? exported : (exported as { default?: unknown }).default
    ) as ScopeTecton
  }

  throw createBuildError({
    file: join(containerRoot, 'package.json'),
    operation: 'load the stylesheet scope plugin',
    expected: `to resolve '${SCOPE_PLUGIN}' from the container or from the build plugin`,
    observed: 'no copy of @tecton/react beside either',
    declaredBy: 'The container stylesheet scope',
    repair:
      'Install @tecton/react (>=0.1.0). Its PostCSS plugin is what contains a container stylesheet, whether or not the container renders the design system itself.',
  })
}
