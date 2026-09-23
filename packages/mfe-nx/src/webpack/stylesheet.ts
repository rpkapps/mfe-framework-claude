/**
 * The generated stylesheet goes through Angular's own global-style chain — extracted into a CSS
 * chunk that loads with each exposed entry — and through the container's PostCSS plugins first:
 * Tailwind, then the scope that confines every rule to this container's mount roots. Component
 * styles never reach it: Angular inlines them and encapsulates them itself.
 */

import { resolve } from 'node:path'

import {
  containerPostcssPlugins,
  generatedPath,
  scopeFallbackPlugin,
  type ContainerPlan,
} from '@company/mfe-build'
import type { Compiler, RuleSetRule } from 'webpack'

const PLUGIN_NAME = 'MfeContainerStylesheet'

/**
 * Angular compiles a `.css` request only when it carries one of its own queries; this one selects
 * the global-style loaders, which extract the stylesheet rather than inlining it as a string.
 */
const GLOBAL_STYLE_QUERY = '?ngGlobalStyle'

/** `currentPlan` is read per file, so a stylesheet compiled after a re-plan uses the new scopes. */
export function applyContainerStylesheet(
  compiler: Compiler,
  currentPlan: () => ContainerPlan,
): void {
  const stylesheet = generatedPath(currentPlan().options.generatedDir, 'styles.css')

  compiler.hooks.normalModuleFactory.tap(PLUGIN_NAME, factory => {
    factory.hooks.beforeResolve.tap(PLUGIN_NAME, data => {
      // The generated entries import it relatively and without a query; nothing else does.
      if (!data.request.startsWith('.')) return
      if (resolve(data.context, data.request) !== stylesheet) return
      data.request = `${data.request}${GLOBAL_STYLE_QUERY}`
    })
  })

  compiler.options.module.rules.push(containerPostcssRule(stylesheet, currentPlan))
}

/**
 * Appended after Angular's rules, so it runs before them: the loaders a resource collects run
 * last-matched first. `config: false` because the container's own PostCSS config, if any, is for
 * its component styles.
 */
function containerPostcssRule(stylesheet: string, currentPlan: () => ContainerPlan): RuleSetRule {
  return {
    test: resource => resource === stylesheet,
    resourceQuery: /ngGlobalStyle/,
    use: [
      {
        loader: require.resolve('postcss-loader'),
        options: {
          postcssOptions: () => {
            const plan = currentPlan()
            return {
              config: false,
              plugins: containerPostcssPlugins({
                scopes: plan.scopes,
                containerRoot: plan.options.containerRoot,
                loadScopePlugin: () => scopeFallbackPlugin,
              }),
            }
          },
        },
      },
    ],
  }
}
