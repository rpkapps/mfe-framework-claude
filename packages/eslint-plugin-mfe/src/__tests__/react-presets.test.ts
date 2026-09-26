import { describe, expect, it } from 'vitest'
import plugin, { author, configs, DEFAULT_ROUTER_FILES } from '../react.ts'
import {
  configuredRuleIds,
  expectAcceptedByEslint,
  expectRulePluginsRegistered,
} from './preset-assertions.ts'

const RULE_IDS = [
  'mfe/no-global-patching',
  'mfe/no-raw-storage',
  'mfe/no-widget-global-effects',
  'mfe/stable-definitions',
]

describe('react subpath surface', () => {
  it('offers the author preset both as an array and as a factory', () => {
    expect(Array.isArray(configs.author)).toBe(true)
    expect(plugin.author).toBe(author)
    expect(plugin.DEFAULT_ROUTER_FILES).toBe(DEFAULT_ROUTER_FILES)
  })
})

describe('author preset', () => {
  const preset = author()

  it('is a non-empty flat-config array with a name on every entry', () => {
    expect(preset.length).toBeGreaterThan(0)
    for (const entry of preset) expect(entry.name, JSON.stringify(entry.files)).toBeTypeOf('string')
  })

  it('turns on the MFE rules, the type-aware TypeScript rules and React Hooks', () => {
    const ids = configuredRuleIds(preset)
    for (const id of RULE_IDS) expect(ids, id).toContain(id)
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
    expect(ids).toContain('react-hooks/purity')
    expect(ids).toContain('react-hooks/set-state-in-render')
    expect(ids).toContain('react-hooks/preserve-manual-memoization')
    expect(ids).toContain('react-hooks/memo-dependencies')
    expect(ids).toContain('no-debugger')
    expect(ids).toContain('no-dupe-keys')
  })

  it('registers a plugin in every config object that turns one of its rules on', () => {
    expectRulePluginsRegistered(preset)
  })

  it('scopes every config object to the files it was asked to cover', () => {
    const scoped = author({ files: ['src/**/*.ts'] })
    for (const entry of scoped) {
      for (const pattern of entry.files ?? []) {
        const patterns = Array.isArray(pattern) ? pattern : [pattern]
        expect(patterns, entry.name ?? '(unnamed)').toContain('src/**/*.ts')
      }
    }
  })

  it('relaxes exactly the five justified rules in test scope, and nothing else', () => {
    const tests = preset.find(entry => entry.name?.endsWith('/tests'))
    expect(tests).toBeDefined()
    expect(Object.entries(tests?.rules ?? {})).toEqual([
      ['mfe/no-global-patching', 'off'],
      ['mfe/no-raw-storage', 'off'],
      ['@typescript-eslint/unbound-method', 'off'],
      ['@typescript-eslint/require-await', 'off'],
      ['@typescript-eslint/no-non-null-assertion', 'off'],
    ])
  })

  it('is accepted by ESLint, rule options included', async () => {
    await expectAcceptedByEslint(preset, 'src/widgets/panel.ts')
  })

  it('scopes the TanStack Router rules to router files inside the covered files', () => {
    const scoped = author({ files: ['src/**/*.ts'], routerFiles: ['src/routes/**/*.tsx'] })
    const routerConfigs = scoped.filter(entry => entry.name?.startsWith('mfe/tanstack-router'))
    expect(routerConfigs.length).toBeGreaterThan(0)
    for (const entry of routerConfigs) {
      // A nested `files` entry is an AND, and the outer pattern is where the parser is set.
      expect(entry.files).toEqual([['src/**/*.ts', 'src/routes/**/*.tsx']])
    }
    const ids = configuredRuleIds(routerConfigs)
    expect(ids).toContain('@tanstack/router/create-route-property-order')
  })

  it('turns on the TanStack Query rules', () => {
    expect(configuredRuleIds(preset)).toContain('@tanstack/query/exhaustive-deps')
  })

  it('passes Widget and storage scopes through to the rules', () => {
    const scoped = author({
      widgetScopes: ['src/widgets/**'],
      storageAllowedScopes: ['src/bootstrap/storage.ts'],
    })
    const entry = scoped.find(config => config.name === 'mfe/author/rules')
    expect(entry?.rules?.['mfe/no-widget-global-effects']).toEqual([
      'error',
      { widgetScopes: ['src/widgets/**'] },
    ])
    expect(entry?.rules?.['mfe/no-raw-storage']).toEqual([
      'error',
      { allowedScopes: ['src/bootstrap/storage.ts'] },
    ])
  })

  it('lets an MFE author keep zustand but not the framework internals or a telemetry SDK', () => {
    const entry = preset.find(config => config.name === 'mfe/author/boundaries')?.rules?.[
      '@typescript-eslint/no-restricted-imports'
    ]
    const [, options] = entry as [
      string,
      {
        paths: { name: string; message: string }[]
        patterns: { group: string[]; message: string }[]
      },
    ]
    const names = options.paths.map(path => path.name)
    expect(names).not.toContain('zustand')
    expect(names).toContain('@company/mfe-core')
    expect(names).toContain('@company/mfe-runtime')
    // The unified application-boundary wording names the React adapter's own subpaths.
    const runtime = options.paths.find(path => path.name === '@company/mfe-runtime')
    expect(runtime?.message).toContain('@company/mfe-react/host')
    expect(runtime?.message).toContain('@company/mfe-react/testing')
    const groups = options.patterns.flatMap(pattern => pattern.group)
    expect(groups).toContain('@company/mfe-react/src/*')
    expect(groups).toContain('@opentelemetry/*')
    expect(groups).toContain('@grafana/faro-*')
    const telemetry = options.patterns.filter(pattern =>
      pattern.group.some(group => group.startsWith('@opentelemetry')),
    )
    for (const pattern of telemetry) {
      expect((pattern as { allowTypeImports?: boolean }).allowTypeImports).toBe(false)
      expect(pattern.message).toContain('useTelemetry()')
      expect(pattern.message).toContain('@company/mfe-react')
    }
  })

  it('keeps agent libraries out of an App or Widget, pointing at useAction', () => {
    const entry = preset.find(config => config.name === 'mfe/author/boundaries')?.rules?.[
      '@typescript-eslint/no-restricted-imports'
    ]
    const [, options] = entry as [
      string,
      {
        paths: { name: string; message: string }[]
        patterns: { group: string[]; message: string; allowTypeImports?: boolean }[]
      },
    ]
    for (const name of ['ai', 'openai', 'langchain']) {
      expect(options.paths.find(path => path.name === name)?.message, name).toContain('useAction()')
    }
    const agent = options.patterns.find(pattern => pattern.group.includes('@tanstack/ai-*'))
    expect(agent?.group).toEqual(
      expect.arrayContaining(['@tanstack/ai', 'ai/*', '@ai-sdk/*', '@ag-ui/*', '@copilotkit/*']),
    )
    expect(agent?.allowTypeImports).toBe(false)
  })
})
