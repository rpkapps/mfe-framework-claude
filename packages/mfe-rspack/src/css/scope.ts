/** The framework supplies the selectors; the design system's own plugin does the scoping (§17). */

import { createRequire } from 'node:module'
import { join } from 'node:path'

import { createBuildError, type ScopePluginFactory } from '@company/mfe-build'

const SCOPE_PLUGIN = '@tecton/react/postcss/scope'

const ownRequire = createRequire(import.meta.url)

/**
 * Resolved from the container root first, so a container on an older design system is scoped by
 * that version's recipe; the fallback scopes a container that does not depend on it at all.
 */
export function loadScopePlugin(containerRoot: string): ScopePluginFactory {
  for (const resolve of [createRequire(join(containerRoot, 'package.json')), ownRequire]) {
    let exported: unknown
    try {
      exported = resolve(SCOPE_PLUGIN)
    } catch {
      // Not installed here; the next resolution says whether it is anywhere.
      continue
    }

    // `require` of an ES module hands back the namespace object, so the plugin is its default.
    // Its type is spelled against the build package's PostCSS: the design system is an optional
    // peer, whose own declaration resolves to nothing where it was not installed.
    return (
      typeof exported === 'function' ? exported : (exported as { default?: unknown }).default
    ) as ScopePluginFactory
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
