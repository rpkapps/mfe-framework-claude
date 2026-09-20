/**
 * The container's CSS, scoped — by the design system's own PostCSS plugin.
 *
 * What a compiled stylesheet needs doing to it before it can share a page is
 * the library's knowledge, not the framework's, and
 * `@tecton/react/postcss/scope` is tested against it. The framework supplies
 * the one thing the library cannot know: the selectors. The scope is one
 * `[data-mfe-scope="<id>"]` per definition the container exports — the
 * attribute a mount root and its body-level overlay root carry — and the lower
 * boundary is `[data-mfe-scope]` itself, which ends a parent App's scope at the
 * root of a nested one.
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'

import type { ScopeTectonOptions } from '@tecton/react/postcss/scope'
import type { Plugin } from 'postcss'

import { createBuildError } from '../diagnostics.ts'

/**
 * The plugin's signature, with the return type spelled against this package's
 * PostCSS rather than taken from the design system's own declaration: PostCSS
 * is an optional peer there, so in a checkout that did not install it the
 * declared `Plugin` resolves to nothing and every call of it becomes untyped.
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

/**
 * The scope plugin for one container, configured with the framework's
 * selectors. It runs after `@tailwindcss/postcss`, on the finished stylesheet.
 */
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
 * Resolved from the container root first, the way `installedVersionFrom` reads
 * a container's versions: the copy of the design system a container compiled
 * its stylesheet against is the copy that should scope it, so a container on
 * an older version keeps that version's recipe.
 *
 * The fallback is this package's own resolution, which is what a container
 * that renders none of the design system's components — and therefore does not
 * depend on it — is scoped by. Its CSS is still its own and still has to be
 * contained, which is why the dependency is declared as an optional peer here
 * rather than left to the container.
 */
function loadScopePlugin(containerRoot: string): ScopeTecton {
  for (const resolve of [createRequire(join(containerRoot, 'package.json')), ownRequire]) {
    let exported: unknown
    try {
      exported = resolve(SCOPE_PLUGIN)
    } catch {
      // Not installed here. The next resolution says whether it is anywhere.
      continue
    }

    // `require` of an ES module hands back the namespace object, so the plugin
    // is its default export; a transpiled copy would be the function itself.
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
