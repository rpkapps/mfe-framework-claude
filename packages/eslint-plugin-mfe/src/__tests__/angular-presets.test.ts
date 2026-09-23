import { describe, expect, it } from 'vitest'
import plugin, { angular, configs, DEFAULT_ANGULAR_TEMPLATE_FILES } from '../angular.ts'
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

describe('angular subpath surface', () => {
  it('offers the angular preset both as an array and as a factory', () => {
    expect(Array.isArray(configs.angular)).toBe(true)
    expect(plugin.angular).toBe(angular)
    expect(plugin.DEFAULT_ANGULAR_TEMPLATE_FILES).toBe(DEFAULT_ANGULAR_TEMPLATE_FILES)
  })
})

describe('angular preset', () => {
  const preset = angular()

  it('is a non-empty flat-config array with a name on every entry', () => {
    expect(preset.length).toBeGreaterThan(0)
    for (const entry of preset) expect(entry.name, JSON.stringify(entry.files)).toBeTypeOf('string')
  })

  it('turns on the MFE rules including the Router analogue, and the type-aware TypeScript rules', () => {
    const ids = configuredRuleIds(preset)
    for (const id of RULE_IDS) expect(ids, id).toContain(id)
    expect(ids).toContain('@typescript-eslint/no-floating-promises')
    expect(ids).toContain('@typescript-eslint/no-unsafe-assignment')
    expect(ids).toContain('@typescript-eslint/no-restricted-imports')
    expect(ids).not.toContain('react-hooks/rules-of-hooks')
  })

  it('turns on angular-eslint TS and template rules explicitly, not spread from `recommended`', () => {
    const ids = configuredRuleIds(preset)
    expect(ids).toContain('@angular-eslint/prefer-standalone')
    expect(ids).toContain('@angular-eslint/prefer-on-push-component-change-detection')
    expect(ids).toContain('@angular-eslint/template/banana-in-box')
    expect(ids).toContain('@angular-eslint/template/prefer-control-flow')
  })

  it('registers the template plugin and processor on the TypeScript files object', () => {
    const tsBlock = preset.find(config => config.name === 'mfe/angular-eslint-ts-recommended')
    expect(tsBlock?.processor).toBe('@angular-eslint/template/extract-inline-html')
    expect(Object.keys(tsBlock?.plugins ?? {})).toContain('@angular-eslint/template')
  })

  it('lints `.html` templates with the angular-eslint template parser', () => {
    const templateBlock = preset.find(
      config => config.name === 'mfe/angular-eslint-template-recommended',
    )
    expect(templateBlock?.files).toEqual(['**/*.html'])
    expect(templateBlock?.languageOptions?.['parser']).toBeDefined()
  })

  it('bans zone.js, NgZone and the adapter-owned bootstrap APIs', () => {
    const boundaries = preset.find(config => config.name === 'mfe/angular/boundaries')
    const entry = boundaries?.rules?.['@typescript-eslint/no-restricted-imports']
    const [, options] = entry as [
      string,
      {
        paths: { name: string; importNames?: string[] }[]
        patterns: { group: string[] }[]
      },
    ]
    const names = options.paths.map(path => path.name)
    expect(names).toContain('zone.js')
    expect(names).toContain('@angular/platform-browser-dynamic')
    const ngCore = options.paths.find(path => path.name === '@angular/core')
    expect(ngCore?.importNames).toEqual(['NgZone'])
    const platformBrowser = options.paths.find(path => path.name === '@angular/platform-browser')
    expect(platformBrowser?.importNames).toEqual(
      expect.arrayContaining(['bootstrapApplication', 'createApplication']),
    )
    const groups = options.patterns.flatMap(pattern => pattern.group)
    expect(groups).toContain('zone.js/*')
  })

  it('forbids mfe-core and mfe-runtime, pointing at the Angular adapter', () => {
    const boundaries = preset.find(config => config.name === 'mfe/angular/boundaries')
    const entry = boundaries?.rules?.['@typescript-eslint/no-restricted-imports']
    const [, options] = entry as [string, { paths: { name: string; message: string }[] }]
    const runtime = options.paths.find(path => path.name === '@company/mfe-runtime')
    expect(runtime?.message).toContain('@company/mfe-angular/host')
    expect(runtime?.message).toContain('@company/mfe-angular/testing')
  })

  it('names the Angular adapter APIs in the shared rules, not the React hooks', () => {
    const rulesBlock = preset.find(config => config.name === 'mfe/angular/rules')
    expect(rulesBlock?.rules?.['mfe/no-global-patching']).toEqual([
      'error',
      {
        signalHook: 'injectMfeSignal()',
        signalModule: '@company/mfe-angular',
        navigationHint: "the Angular `Router`, scoped to your App's own `BoundaryLocationStrategy`",
        navigatorModule: '@company/mfe-runtime',
      },
    ])
    expect(rulesBlock?.rules?.['mfe/no-raw-storage']).toEqual([
      'error',
      {
        allowedScopes: [],
        storedStateHook: 'injectStoredState()',
        storageHook: 'injectMfeStorage()',
        adapterModule: '@company/mfe-angular',
      },
    ])
    expect(rulesBlock?.rules?.['mfe/stable-definitions']).toEqual([
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
    expect(rulesBlock?.rules?.['mfe/no-widget-global-router']).toEqual([
      'error',
      { widgetScopes: [], emitAccess: '`injectWidgetEmit()`' },
    ])
  })

  it('registers a plugin in every config object that turns one of its rules on', () => {
    // `@angular-eslint/template/x` registers under the `@angular-eslint/template` plugin key.
    expectRulePluginsRegistered(preset, ruleId =>
      ruleId.startsWith('@angular-eslint/template/') ? '@angular-eslint/template' : undefined,
    )
  })

  it('is accepted by ESLint, rule options included', async () => {
    await expectAcceptedByEslint(preset, 'src/widgets/panel.ts')
  })
})
