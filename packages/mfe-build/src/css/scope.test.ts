import postcss, { type Plugin } from 'postcss'
import { describe, expect, it } from 'vitest'

import { isMfeBuildError } from '../diagnostics.ts'
import { containerPostcssPlugins } from './postcss-plugins.ts'
import { scopeFallbackPlugin } from './scope-fallback.ts'
import { containerScopePlugin, type ScopeOptions, type ScopePluginLoader } from './scope.ts'

const CONTAINER_ROOT = '/containers/operations'

/** A loader that records what it was asked for and scopes nothing. */
function recordingLoader() {
  const roots: string[] = []
  const options: ScopeOptions[] = []
  const load: ScopePluginLoader = containerRoot => {
    roots.push(containerRoot)
    return given => {
      options.push(given)
      return { postcssPlugin: 'recorded' }
    }
  }
  return { load, roots, options }
}

describe('containerScopePlugin', () => {
  it('hands the plugin the mount-root selectors, the boundary and the keyframes suffix', () => {
    const loader = recordingLoader()

    containerScopePlugin({
      scopes: ['ops', 'order-row'],
      containerRoot: CONTAINER_ROOT,
      loadScopePlugin: loader.load,
    })

    expect(loader.roots).toEqual([CONTAINER_ROOT])
    expect(loader.options).toEqual([
      {
        scope: '[data-mfe-scope="ops"], [data-mfe-scope="order-row"]',
        boundary: '[data-mfe-scope]',
        keyframes: { suffix: 'ops-order-row' },
      },
    ])
  })

  it('reports a container with no definitions before it looks for a plugin', () => {
    const loader = recordingLoader()

    try {
      containerScopePlugin({
        scopes: [],
        containerRoot: CONTAINER_ROOT,
        loadScopePlugin: loader.load,
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(isMfeBuildError(error)).toBe(true)
      expect((error as Error).message).toContain('at least one definition id')
      expect((error as Error).message).toContain('data-mfe-scope')
    }
    expect(loader.roots).toHaveLength(0)
  })

  it('scopes with the built-in plugin for an integration that opts into it', () => {
    const plugin = containerScopePlugin({
      scopes: ['ops'],
      containerRoot: CONTAINER_ROOT,
      loadScopePlugin: () => scopeFallbackPlugin,
    })

    expect(postcss([plugin]).process('.a { color: red; }', { from: undefined }).css).toContain(
      '@scope ([data-mfe-scope="ops"]) to ([data-mfe-scope]) {',
    )
  })
})

describe('containerPostcssPlugins', () => {
  const names = (plugins: readonly unknown[]): readonly unknown[] =>
    plugins.map(plugin => (plugin as Plugin).postcssPlugin)

  it('runs Tailwind first, so the scope plugin sees the utilities it generated', () => {
    const plugins = containerPostcssPlugins({
      scopes: ['ops'],
      containerRoot: CONTAINER_ROOT,
      loadScopePlugin: () => scopeFallbackPlugin,
    })

    expect(names(plugins)).toEqual(['@tailwindcss/postcss', 'mfe-scope-fallback'])
  })

  it('adds no second Tailwind to a container whose own config already runs one', () => {
    const plugins = containerPostcssPlugins({
      scopes: ['ops'],
      containerRoot: CONTAINER_ROOT,
      loadScopePlugin: () => scopeFallbackPlugin,
      configured: { plugins: [{ postcssPlugin: '@tailwindcss/postcss' }] },
    })

    expect(names(plugins)).toEqual(['mfe-scope-fallback'])
  })
})
