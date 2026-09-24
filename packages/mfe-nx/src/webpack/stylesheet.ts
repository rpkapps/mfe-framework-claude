/**
 * The generated stylesheet goes through Angular's own global-style chain — extracted into a CSS
 * chunk that loads with each exposed entry — and through CSS import resolution before the scope
 * plugin confines every rule to this container's mount roots. Component styles never reach it:
 * Angular inlines them and encapsulates them itself.
 */

import type { Compiler, RuleSetRule } from 'webpack'

import {
  containerPostcssPlugins,
  scopeFallbackPlugin,
  type ContainerPlan,
} from '@company/mfe-build'

/**
 * Appended after Angular's rules, so it runs before them: the loaders a resource collects run
 * last-matched first. The generated entries import the stylesheet with the query Angular's
 * global-style rule selects on. `config: false` because the container's own PostCSS config, if
 * any, is for its component styles. `currentPlan` is read per file, so a stylesheet compiled
 * after a re-plan uses the new scopes.
 */
export function applyContainerStylesheet(
  compiler: Compiler,
  currentPlan: () => ContainerPlan,
): void {
  const { stylesheet } = currentPlan()

  const rule: RuleSetRule = {
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
                tailwind: plan.tailwind,
              }),
            }
          },
        },
      },
    ],
  }
  compiler.options.module.rules.push(rule)
}
