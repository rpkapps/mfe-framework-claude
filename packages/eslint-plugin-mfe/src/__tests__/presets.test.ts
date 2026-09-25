import { describe, expect, it } from 'vitest'
import plugin, { application, configs, framework, rules, tooling } from '../index.ts'
import {
  configuredRuleIds,
  expectAcceptedByEslint,
  expectRulePluginsRegistered,
} from './preset-assertions.ts'

const RULE_IDS = [
  'mfe/no-global-patching',
  'mfe/no-raw-storage',
  'mfe/no-widget-global-effects',
  'mfe/no-widget-global-router',
  'mfe/stable-definitions',
]

describe('plugin surface', () => {
  it('exposes the five MFE rules under the names the presets configure', () => {
    expect(Object.keys(rules).sort()).toEqual([
      'no-global-patching',
      'no-raw-storage',
      'no-widget-global-effects',
      'no-widget-global-router',
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

  it('offers the neutral presets both as arrays and as factories', () => {
    expect(Array.isArray(configs.framework)).toBe(true)
    expect(Array.isArray(configs.tooling)).toBe(true)
    expect(plugin.framework).toBe(framework)
    expect(plugin.tooling).toBe(tooling)
    expect(plugin.application).toBe(application)
  })

  it('does not export a React or Angular author preset from the neutral entry', () => {
    expect(Reflect.has(plugin, 'author')).toBe(false)
    expect(Reflect.has(plugin, 'angular')).toBe(false)
  })
})

describe('tooling preset', () => {
  const preset = tooling()

  it('is a non-empty flat-config array with a name on every entry', () => {
    expect(preset.length).toBeGreaterThan(0)
    for (const entry of preset) expect(entry.name, JSON.stringify(entry.files)).toBeTypeOf('string')
  })

  it('registers a plugin in every config object that turns one of its rules on', () => {
    expectRulePluginsRegistered(preset)
  })

  it('keeps the type-aware layers and leaves out the rules about being an MFE', () => {
    const ids = configuredRuleIds(preset)
    expect(ids).toContain('@typescript-eslint/no-floating-promises')
    expect(ids).toContain('@typescript-eslint/no-unsafe-assignment')
    expect(ids).toContain('@typescript-eslint/consistent-type-imports')
    expect(ids).toContain('no-debugger')
    // A build configuration is not part of the runtime import DAG, so none of these apply.
    for (const absent of [...RULE_IDS, 'react-hooks/rules-of-hooks']) {
      expect([...ids], absent).not.toContain(absent)
    }
  })

  it('covers the files named after the tool that reads them, and no package source', () => {
    const patterns = new Set(preset.flatMap(entry => entry.files ?? []).flat())
    expect(patterns).toContain('**/rsbuild.config.{ts,mts,cts}')
    expect(patterns).toContain('**/vitest.setup.{ts,tsx}')
    // `src/mfe.config.ts` is the package's own source: a bare `*.config.ts` would claim it.
    for (const pattern of patterns) expect(pattern).not.toBe('**/*.config.{ts,mts,cts}')
  })

  it('allows the single-extends interface only in a setup file', () => {
    const entry = preset.find(config => config.name === 'mfe/tooling/matcher-augmentation')
    expect(entry?.rules?.['@typescript-eslint/no-empty-object-type']).toEqual([
      'error',
      { allowInterfaces: 'with-single-extends' },
    ])
    for (const pattern of entry?.files ?? []) {
      expect(Array.isArray(pattern) ? pattern.at(-1) : pattern).toBe('**/vitest.setup.{ts,tsx}')
    }
  })
})

describe('framework preset', () => {
  const preset = framework()

  it('is a non-empty flat-config array with a name on every entry', () => {
    expect(preset.length).toBeGreaterThan(0)
    for (const entry of preset) expect(entry.name, JSON.stringify(entry.files)).toBeTypeOf('string')
  })

  it('turns on the MFE rules, the type-aware TypeScript rules and React Hooks', () => {
    const ids = configuredRuleIds(preset)
    for (const id of RULE_IDS) {
      // `no-widget-global-router` is Angular-only and not part of the framework preset.
      if (id === 'mfe/no-widget-global-router') continue
      expect(ids, id).toContain(id)
    }
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

  it('registers a plugin in every config object that turns one of its rules on', () => {
    expectRulePluginsRegistered(preset)
  })

  it('scopes every config object to the files it was asked to cover', () => {
    const scoped = framework({ files: ['packages/*/src/**/*.ts'] })
    for (const entry of scoped) {
      for (const pattern of entry.files ?? []) {
        const patterns = Array.isArray(pattern) ? pattern : [pattern]
        expect(patterns, entry.name ?? '(unnamed)').toContain('packages/*/src/**/*.ts')
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

  it('keeps the rules that find real defects in tests switched on there', () => {
    const tests = preset.find(entry => entry.name?.endsWith('/tests'))
    const relaxed = new Set(Object.keys(tests?.rules ?? {}))
    for (const guarded of [
      '@typescript-eslint/no-floating-promises',
      '@typescript-eslint/no-misused-promises',
      '@typescript-eslint/no-unsafe-argument',
      '@typescript-eslint/no-unsafe-assignment',
      '@typescript-eslint/no-unsafe-call',
      '@typescript-eslint/no-unsafe-member-access',
      '@typescript-eslint/no-unsafe-return',
      'react-hooks/rules-of-hooks',
      'react-hooks/refs',
      'react-hooks/set-state-in-render',
    ]) {
      expect(relaxed, guarded).not.toContain(guarded)
    }
  })

  it('scopes the test exceptions to test files, not to whole packages', () => {
    const tests = preset.find(entry => entry.name?.endsWith('/tests'))
    for (const pattern of tests?.files ?? []) {
      const patterns = Array.isArray(pattern) ? pattern : [pattern]
      const scope = patterns.at(-1) ?? ''
      expect(
        /\*\.(test|spec)\.|__tests__|vitest\.setup/.test(scope),
        `${scope} is not a test-file scope`,
      ).toBe(true)
    }
  })

  it('applies the React rules to everything in `files` by default', () => {
    const scoped = framework({ files: ['packages/*/src/**/*.ts'] })
    const reactBlocks = scoped.filter(entry => entry.name?.startsWith('mfe/react-') === true)
    expect(reactBlocks.length).toBeGreaterThan(0)
    for (const entry of reactBlocks) {
      expect(entry.files, entry.name ?? '(unnamed)').toEqual(['packages/*/src/**/*.ts'])
    }
  })

  it('narrows the React rules to `reactFiles`, intersected with `files`', () => {
    const scoped = framework({
      files: ['packages/*/src/**/*.ts'],
      reactFiles: ['packages/mfe-react/src/**/*.ts'],
    })
    const reactBlocks = scoped.filter(entry => entry.name?.startsWith('mfe/react-') === true)
    expect(reactBlocks.length).toBeGreaterThan(0)
    for (const entry of reactBlocks) {
      // AND semantics: React code *and* inside the files the preset covers.
      expect(entry.files, entry.name ?? '(unnamed)').toEqual([
        ['packages/*/src/**/*.ts', 'packages/mfe-react/src/**/*.ts'],
      ])
    }
    const typeSafetyBlock = scoped.find(entry => entry.name === 'mfe/type-safety')
    expect(typeSafetyBlock?.files).toEqual(['packages/*/src/**/*.ts'])
  })

  it('leaves no config object registering react-hooks outside `reactFiles`', () => {
    const scoped = framework({
      files: ['packages/*/src/**/*.ts'],
      reactFiles: ['packages/mfe-react/src/**/*.ts'],
    })
    for (const entry of scoped) {
      const namesReactRule = Object.keys(entry.rules ?? {}).some(ruleId =>
        ruleId.startsWith('react-hooks/'),
      )
      if (!namesReactRule) continue
      for (const pattern of entry.files ?? []) {
        const patterns = Array.isArray(pattern) ? pattern : [pattern]
        expect(patterns, entry.name ?? '(unnamed)').toContain('packages/mfe-react/src/**/*.ts')
      }
    }
  })

  it('is accepted by ESLint, rule options included', async () => {
    await expectAcceptedByEslint(preset, 'packages/mfe-runtime/src/x.ts')
  })

  it('restricts the framework packages to their side of the import DAG', () => {
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
      '@company/mfe-runtime',
      '@company/mfe-react',
    ]) {
      expect(names, forbidden).toContain(forbidden)
    }
    const groups = options.patterns.flatMap(pattern => pattern.group)
    expect(groups).toContain('@module-federation/*')
    expect(groups).toContain('@opentelemetry/*')
    expect(groups).toContain('@grafana/faro-*')
  })

  it('keeps every framework package, and each zone of one, free of agent libraries', () => {
    // Every config object that sets the rule, since the last one to match a file replaces it.
    const restricting = preset.filter(
      config => config.rules?.['@typescript-eslint/no-restricted-imports'] !== undefined,
    )
    expect(restricting.length).toBeGreaterThan(1)
    for (const config of restricting) {
      const [, options] = config.rules?.['@typescript-eslint/no-restricted-imports'] as [
        string,
        { paths: { name: string }[]; patterns: { group: string[]; message: string }[] },
      ]
      expect(
        options.paths.map(path => path.name),
        config.name,
      ).toContain('ai')
      const groups = options.patterns.flatMap(pattern => pattern.group)
      for (const group of ['@tanstack/ai-*', '@ai-sdk/*', '@ag-ui/*', '@copilotkit/*']) {
        expect(groups, `${config.name ?? ''} ${group}`).toContain(group)
      }
    }
  })

  it('names the Angular adapter, not the React hooks, inside packages/mfe-angular', () => {
    const angularBlock = preset.find(
      config => config.name === 'mfe/framework/rules-angular-wording',
    )
    expect(angularBlock).toBeDefined()
    const patching = angularBlock?.rules?.['mfe/no-global-patching']
    expect(patching).toEqual([
      'error',
      {
        signalHook: 'injectMfeSignal()',
        signalModule: '@company/mfe-angular',
        navigationHint: "the Angular `Router`, scoped to your App's own `BoundaryLocationStrategy`",
        navigatorModule: '@company/mfe-runtime',
      },
    ])
    const storage = angularBlock?.rules?.['mfe/no-raw-storage']
    expect(storage).toEqual([
      'error',
      {
        allowedScopes: [],
        storedStateHook: 'injectStoredState()',
        storageHook: 'injectMfeStorage()',
        adapterModule: '@company/mfe-angular',
      },
    ])
    const stableDefinitions = angularBlock?.rules?.['mfe/stable-definitions']
    expect(stableDefinitions).toEqual([
      'error',
      {
        modules: [
          '@company/mfe-react',
          '@company/mfe-runtime',
          '@company/mfe-core',
          '@company/mfe-angular',
        ],
      },
    ])
    // The generic block still names React's hooks for every other framework package.
    const generic = preset.find(config => config.name === 'mfe/framework/rules')
    expect(generic?.rules?.['mfe/no-global-patching']).toBe('error')
  })
})

describe('application preset', () => {
  it('forbids mfe-core and mfe-runtime, naming the given adapter', () => {
    const preset = application({ adapterModules: ['@company/mfe-react'] })
    const entry = preset.find(config => config.name === 'mfe/application/boundaries')
    const rule = entry?.rules?.['@typescript-eslint/no-restricted-imports']
    const [, options] = rule as [string, { paths: { name: string; message: string }[] }]
    const core = options.paths.find(path => path.name === '@company/mfe-core')
    const runtime = options.paths.find(path => path.name === '@company/mfe-runtime')
    expect(core?.message).toContain('@company/mfe-react')
    expect(runtime?.message).toContain('@company/mfe-react/host')
    expect(runtime?.message).toContain('@company/mfe-react/testing')
  })

  it('names every adapter it is given, for a cross-adapter host', () => {
    const preset = application({ adapterModules: ['@company/mfe-react', '@company/mfe-angular'] })
    const entry = preset.find(config => config.name === 'mfe/application/boundaries')
    const rule = entry?.rules?.['@typescript-eslint/no-restricted-imports']
    const [, options] = rule as [string, { paths: { name: string; message: string }[] }]
    const runtime = options.paths.find(path => path.name === '@company/mfe-runtime')
    expect(runtime?.message).toContain('@company/mfe-react')
    expect(runtime?.message).toContain('@company/mfe-angular')
  })

  it('is a single, minimal config object: no parser, no other plugin', () => {
    const preset = application({ adapterModules: ['@company/mfe-react'] })
    expect(preset).toHaveLength(1)
    expect(preset[0]?.languageOptions).toBeUndefined()
  })
})
