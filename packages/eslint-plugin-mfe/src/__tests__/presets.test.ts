import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import plugin, { author, configs, framework, rules } from '../index.ts'

const RULE_IDS = [
  'mfe/no-global-patching',
  'mfe/no-raw-storage',
  'mfe/no-widget-global-effects',
  'mfe/stable-definitions',
]

/** Every rule a preset turns on, as `pluginName/ruleName`. */
function configuredRuleIds(config: readonly { rules?: object | undefined }[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of config) {
    for (const id of Object.keys(entry.rules ?? {})) ids.add(id)
  }
  return ids
}

describe('plugin surface', () => {
  it('exposes the four MFE rules under the names the presets configure', () => {
    expect(Object.keys(rules).sort()).toEqual([
      'no-global-patching',
      'no-raw-storage',
      'no-widget-global-effects',
      'stable-definitions',
    ])
  })

  it('gives every rule docs metadata, a description and messages', () => {
    for (const [name, rule] of Object.entries(rules)) {
      expect(rule.meta?.docs?.description, name).toBeTypeOf('string')
      expect(rule.meta?.docs?.url, name).toContain(name)
      expect(Object.keys(rule.meta?.messages ?? {}).length, name).toBeGreaterThan(0)
    }
  })

  it('never autofixes, because no repair here preserves semantics', () => {
    for (const [name, rule] of Object.entries(rules)) {
      expect(rule.meta?.fixable, name).toBeUndefined()
    }
  })

  it('offers the presets both as arrays and as factories', () => {
    expect(Array.isArray(configs.framework)).toBe(true)
    expect(Array.isArray(configs.author)).toBe(true)
    expect(plugin.framework).toBe(framework)
    expect(plugin.author).toBe(author)
  })
})

describe.each([
  ['framework', framework()],
  ['author', author()],
])('%s preset', (name, preset) => {
  it('is a non-empty flat-config array with a name on every entry', () => {
    expect(preset.length).toBeGreaterThan(0)
    for (const entry of preset) expect(entry.name, JSON.stringify(entry.files)).toBeTypeOf('string')
  })

  it('turns on the MFE rules, the type-aware TypeScript rules and React Hooks', () => {
    const ids = configuredRuleIds(preset)
    for (const id of RULE_IDS) expect(ids, name).toContain(id)
    expect(ids).toContain('@typescript-eslint/no-floating-promises')
    expect(ids).toContain('@typescript-eslint/no-misused-promises')
    expect(ids).toContain('@typescript-eslint/no-unsafe-assignment')
    expect(ids).toContain('@typescript-eslint/switch-exhaustiveness-check')
    expect(ids).toContain('@typescript-eslint/consistent-type-imports')
    expect(ids).toContain('@typescript-eslint/ban-ts-comment')
    expect(ids).toContain('@typescript-eslint/no-shadow')
    expect(ids).toContain('@typescript-eslint/no-unused-vars')
    expect(ids).toContain('@typescript-eslint/no-restricted-imports')
    expect(ids).toContain('react-hooks/rules-of-hooks')
    // React Compiler diagnostics shipped by eslint-plugin-react-hooks 7.
    expect(ids).toContain('react-hooks/purity')
    expect(ids).toContain('react-hooks/set-state-in-render')
    expect(ids).toContain('react-hooks/preserve-manual-memoization')
    expect(ids).toContain('react-hooks/memo-dependencies')
    // ESLint's own recommended baseline.
    expect(ids).toContain('no-debugger')
    expect(ids).toContain('no-dupe-keys')
  })

  it('is accepted by ESLint, rule options included', async () => {
    const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: preset })
    const resolved: unknown = await eslint.calculateConfigForFile('src/widgets/panel.ts')
    expect(resolved).toBeTypeOf('object')
  })
})

describe('preset options', () => {
  it('scopes the TanStack Router rules to router files only, in the author preset', () => {
    const preset = author({ routerFiles: ['src/routes/**/*.tsx'] })
    const routerConfigs = preset.filter(entry => entry.name?.startsWith('mfe/tanstack-router'))
    expect(routerConfigs.length).toBeGreaterThan(0)
    for (const entry of routerConfigs) expect(entry.files).toEqual(['src/routes/**/*.tsx'])
    const ids = configuredRuleIds(routerConfigs)
    expect(ids).toContain('@tanstack/router/create-route-property-order')
  })

  it('turns on the TanStack Query rules in the author preset only', () => {
    expect(configuredRuleIds(author())).toContain('@tanstack/query/exhaustive-deps')
    expect(configuredRuleIds(framework())).not.toContain('@tanstack/query/exhaustive-deps')
  })

  it('passes Widget and storage scopes through to the rules', () => {
    const preset = author({
      widgetScopes: ['src/widgets/**'],
      storageAllowedScopes: ['src/bootstrap/storage.ts'],
    })
    const entry = preset.find(config => config.name === 'mfe/author/rules')
    expect(entry?.rules?.['mfe/no-widget-global-effects']).toEqual([
      'error',
      { widgetScopes: ['src/widgets/**'] },
    ])
    expect(entry?.rules?.['mfe/no-raw-storage']).toEqual([
      'error',
      { allowedScopes: ['src/bootstrap/storage.ts'] },
    ])
  })

  it('restricts the framework packages to their side of the import DAG', () => {
    const preset = framework()
    const core = preset.find(config => config.name === 'mfe/zone/mfe-core')
    const entry = core?.rules?.['@typescript-eslint/no-restricted-imports']
    expect(Array.isArray(entry)).toBe(true)
    const [, options] = entry as [
      string,
      { paths: { name: string }[]; patterns: { group: string[] }[] },
    ]
    const names = options.paths.map(path => path.name)
    for (const forbidden of [
      'react',
      'react-dom',
      '@tanstack/react-router',
      '@tanstack/react-query',
      'single-spa',
      'zustand',
      'redux',
      'mobx',
      'jotai',
      '@tanstack/store',
      '@company/mfe-host',
      '@company/mfe-react',
    ]) {
      expect(names, forbidden).toContain(forbidden)
    }
    const groups = options.patterns.flatMap(pattern => pattern.group)
    expect(groups).toContain('@module-federation/*')
    expect(groups).toContain('@opentelemetry/*')
    expect(groups).toContain('@grafana/faro-*')
  })

  it('lets an MFE author keep zustand but not the framework internals or a telemetry SDK', () => {
    const entry = author().find(config => config.name === 'mfe/author/boundaries')?.rules?.[
      '@typescript-eslint/no-restricted-imports'
    ]
    const [, options] = entry as [
      string,
      { paths: { name: string }[]; patterns: { group: string[] }[] },
    ]
    const names = options.paths.map(path => path.name)
    expect(names).not.toContain('zustand')
    expect(names).toContain('@company/mfe-core')
    expect(names).toContain('@company/mfe-host')
    const groups = options.patterns.flatMap(pattern => pattern.group)
    expect(groups).toContain('@company/mfe-react/src/*')
    expect(groups).toContain('@opentelemetry/*')
    expect(groups).toContain('@grafana/faro-*')
    // Type-only imports of a telemetry vendor are restricted too.
    const telemetry = options.patterns.filter(pattern =>
      pattern.group.some(group => group.startsWith('@opentelemetry')),
    )
    for (const pattern of telemetry) {
      expect((pattern as { allowTypeImports?: boolean }).allowTypeImports).toBe(false)
    }
  })
})
