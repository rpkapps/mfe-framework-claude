/**
 * End-to-end lint of real files: flat config resolves a rule's plugin from the objects that match
 * the file, so a preset can look complete and still fail the moment ESLint is pointed at one.
 */

import { ESLint } from 'eslint'
import type { Linter } from 'eslint'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import mfe, { framework, tooling } from '../index.ts'
import { author } from '../react.ts'
import { angular } from '../angular.ts'

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2023',
    lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    moduleDetection: 'force',
    strict: true,
    noUncheckedIndexedAccess: true,
    jsx: 'react-jsx',
    noEmit: true,
    skipLibCheck: true,
    types: [],
  },
  include: ['**/*.ts', '**/*.tsx'],
})

/** Trips the three rules relaxed in test scope, plus `no-floating-promises`, which is not. */
const SERVICE_SOURCE = `export class Service {
  value = 1
  read(): number {
    return this.value
  }
}
const service = new Service()
export const unbound = service.read
const readings: number[] = [service.read()]
export const first = readings[0]!.toFixed(2)
export async function helper(): Promise<number> {
  return service.read()
}
export function leak(): void {
  helper()
}
`

const projects: string[] = []

function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'mfe-eslint-e2e-'))
  projects.push(root)
  writeFileSync(join(root, 'tsconfig.json'), TSCONFIG)
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = join(root, relative)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, contents)
  }
  return root
}

afterAll(() => {
  for (const root of projects) rmSync(root, { recursive: true, force: true })
})

/**
 * ESLint reports the host's own path, so on Windows an `endsWith('src/x.ts')` matched nothing and
 * read, at the assertion, as "the rule never fired".
 */
function resultFor(
  results: readonly ESLint.LintResult[],
  suffix: string,
): ESLint.LintResult | undefined {
  return results.find(result => result.filePath.split(sep).join('/').endsWith(suffix))
}

async function lint(
  root: string,
  config: Linter.Config[],
): Promise<{
  ruleIds: Set<string>
  fatal: string[]
  unattributed: string[]
  results: ESLint.LintResult[]
}> {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config })
  // A missing plugin or a bad rule option throws from here, so reaching the assertions is the test.
  const results = await eslint.lintFiles(['.'])
  const ruleIds = new Set<string>()
  const fatal: string[] = []
  const unattributed: string[] = []
  for (const result of results) {
    for (const message of result.messages) {
      if (message.fatal === true) fatal.push(`${result.filePath}: ${message.message}`)
      if (message.ruleId === null) unattributed.push(`${result.filePath}: ${message.message}`)
      else ruleIds.add(message.ruleId)
    }
  }
  return { ruleIds, fatal, unattributed, results }
}

describe('framework preset, linting real files', () => {
  const root = makeProject({
    'packages/mfe-core/src/leak.ts': `import { useState } from 'react'
export const hook = useState
`,
    'packages/mfe-runtime/src/boot.ts': `export async function load(): Promise<void> {
  await Promise.resolve()
}
export function boot(): void {
  load()
  window.fetch = globalThis.fetch.bind(globalThis)
  localStorage.setItem('mfe:boot', 'true')
}
`,
    'packages/mfe-react/src/use-thing.ts': `import { useState } from 'react'
import { createWidget } from '@company/mfe-react'
export function useThing(flag: boolean): unknown {
  if (flag) {
    const [value] = useState(0)
    return createWidget({ id: 'a', value })
  }
  return null
}
`,
    // The same source twice: only the test copy gets the scoped exceptions.
    'packages/mfe-runtime/src/service.ts': SERVICE_SOURCE,
    'packages/mfe-runtime/src/service.test.ts': SERVICE_SOURCE,
    // No React here, but the bundler helper named `use` reads as React's `use()` hook.
    'packages/mfe-rspack/src/plugin.ts': `interface ModuleRule {
  test: RegExp
  use: readonly string[]
}
export function applyReactCompiler(rules: ModuleRule[]): void {
  const use = (jsx: boolean): readonly string[] =>
    jsx ? ['babel-loader', 'jsx-loader'] : ['babel-loader']
  rules.push({ test: /\\.tsx$/, use: use(true) })
  rules.push({ test: /\\.ts$/, use: use(false) })
}
`,
    'packages/mfe-runtime/src/clean.ts': `export function add(left: number, right: number): number {
  return left + right
}
`,
    // Outside the caller's `files`: the regression is linting it without a parser.
    'vitest.config.ts': `const config: { root: string } = { root: process.cwd() }
export default config
`,
  })

  const preset = framework({
    tsconfigRootDir: root,
    files: ['packages/*/src/**/*.{ts,tsx}'],
  })

  it('runs without a configuration error and parses every file it claims', async () => {
    const summary = await lint(root, preset)
    expect(summary.fatal).toEqual([])
    expect(summary.unattributed).toEqual([])
    expect(summary.results.length).toBeGreaterThan(0)
  })

  it('applies every layer of the preset to the files it covers', async () => {
    const { ruleIds } = await lint(root, preset)
    expect([...ruleIds]).toContain('@typescript-eslint/no-floating-promises')
    expect([...ruleIds]).toContain('@typescript-eslint/no-restricted-imports')
    expect([...ruleIds]).toContain('mfe/no-global-patching')
    expect([...ruleIds]).toContain('mfe/no-raw-storage')
    expect([...ruleIds]).toContain('mfe/stable-definitions')
    expect([...ruleIds]).toContain('react-hooks/rules-of-hooks')
  })

  it('accepts the plugin named beside the preset, because both are the same object', async () => {
    // Flat config throws "Cannot redefine plugin" for two different objects under one name.
    const summary = await lint(root, [{ plugins: { mfe } }, ...preset])
    expect(summary.fatal).toEqual([])
    expect([...summary.ruleIds]).toContain('mfe/no-global-patching')
  })

  it('leaves a TypeScript file outside the configured files untouched', async () => {
    const { results } = await lint(root, preset)
    const linted = results.map(result => result.filePath)
    expect(linted.some(path => path.split(sep).join('/').endsWith('vitest.config.ts'))).toBe(false)
  })

  it('reports nothing in a file that respects the boundaries', async () => {
    const { results } = await lint(root, preset)
    const clean = resultFor(results, 'clean.ts')
    expect(clean?.messages).toEqual([])
  })

  it('applies the test-scope exceptions in a test file', async () => {
    const { results } = await lint(root, preset)
    const test = resultFor(results, 'service.test.ts')
    const ruleIds = (test?.messages ?? []).map(message => message.ruleId)
    expect(ruleIds).not.toContain('@typescript-eslint/unbound-method')
    expect(ruleIds).not.toContain('@typescript-eslint/require-await')
    expect(ruleIds).not.toContain('@typescript-eslint/no-non-null-assertion')
    expect(ruleIds).toContain('@typescript-eslint/no-floating-promises')
  })

  it('applies the React rules everywhere by default, hook-shaped API and all', async () => {
    const { results } = await lint(root, preset)
    const plugin = resultFor(results, 'rspack/src/plugin.ts')
    const ruleIds = (plugin?.messages ?? []).map(message => message.ruleId)
    expect(ruleIds).toContain('react-hooks/rules-of-hooks')
  })

  it('stops linting a non-React package with React rules when reactFiles is narrowed', async () => {
    const narrowed = framework({
      tsconfigRootDir: root,
      files: ['packages/*/src/**/*.{ts,tsx}'],
      reactFiles: ['packages/mfe-react/src/**/*.{ts,tsx}'],
    })
    const { results, fatal } = await lint(root, narrowed)
    expect(fatal).toEqual([])

    const plugin = resultFor(results, 'rspack/src/plugin.ts')
    const pluginRules = (plugin?.messages ?? []).map(message => message.ruleId ?? '')
    expect(pluginRules.filter(ruleId => ruleId.startsWith('react-hooks/'))).toEqual([])

    const react = resultFor(results, 'mfe-react/src/use-thing.ts')
    expect((react?.messages ?? []).map(message => message.ruleId)).toContain(
      'react-hooks/rules-of-hooks',
    )
    const host = resultFor(results, 'mfe-runtime/src/boot.ts')
    expect((host?.messages ?? []).map(message => message.ruleId)).toContain(
      '@typescript-eslint/no-floating-promises',
    )
  })

  it('applies those same rules normally outside test scope', async () => {
    const { results } = await lint(root, preset)
    const production = results.find(
      result => result.filePath.endsWith('service.ts') && !result.filePath.endsWith('.test.ts'),
    )
    const ruleIds = (production?.messages ?? []).map(message => message.ruleId)
    expect(ruleIds).toContain('@typescript-eslint/unbound-method')
    expect(ruleIds).toContain('@typescript-eslint/require-await')
    expect(ruleIds).toContain('@typescript-eslint/no-non-null-assertion')
    expect(ruleIds).toContain('@typescript-eslint/no-floating-promises')
  })
})

describe('author preset, linting real files', () => {
  const root = makeProject({
    'src/store.ts': `import { create } from 'zustand'
export const useStore = create
`,
    'src/boundaries.ts': `import type { MfeError } from '@company/mfe-core'
import { trace } from '@opentelemetry/api'
import { mountApp } from '@company/mfe-runtime/dist/mount.js'
export type Thing = MfeError
export const tracer = trace
export const mount = mountApp
`,
    'src/routes/index.ts': `import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/')({
  loader: () => null,
  beforeLoad: () => null,
})
`,
    'src/widgets/panel.ts': `export function renderPanel(): void {
  document.title = 'Reports'
  history.pushState(null, '', '/reports')
}
`,
    'src/clean.ts': `export function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0)
}
`,
    'src/agent.ts': `import { useChat } from '@tanstack/ai-react'
import type { UIMessage } from 'ai'
import { streamText } from 'ai/rsc'
import { HttpAgent } from '@ag-ui/client'
import { actionTools } from '@company/mfe-agent/actions'
import { local } from './ai'
import { helper } from './ai/helper'
export const hooks = [useChat, streamText, HttpAgent, actionTools, local, helper]
export type Message = UIMessage
`,
    'src/ai.ts': `export const local = 1
`,
    'src/ai/helper.ts': `export const helper = 1
`,
  })

  const preset = author({
    tsconfigRootDir: root,
    files: ['src/**/*.{ts,tsx}'],
    widgetScopes: ['src/widgets/**'],
  })

  it('runs without a configuration error and parses every file it claims', async () => {
    const summary = await lint(root, preset)
    expect(summary.fatal).toEqual([])
    expect(summary.unattributed).toEqual([])
    expect(summary.results.length).toBeGreaterThan(0)
  })

  it('applies every layer of the preset, including both TanStack plugins', async () => {
    const { ruleIds } = await lint(root, preset)
    expect([...ruleIds]).toContain('@typescript-eslint/no-restricted-imports')
    expect([...ruleIds]).toContain('@tanstack/router/create-route-property-order')
    expect([...ruleIds]).toContain('mfe/no-widget-global-effects')
  })

  it('restricts framework internals and telemetry vendors but not zustand', async () => {
    const { results } = await lint(root, preset)
    const boundaries = resultFor(results, 'boundaries.ts')
    const restricted = (boundaries?.messages ?? []).filter(
      message => message.ruleId === '@typescript-eslint/no-restricted-imports',
    )
    // @company/mfe-core type-only, @opentelemetry/api, and the deep @company/mfe-runtime path.
    expect(restricted.length).toBe(3)

    const store = resultFor(results, 'store.ts')
    const zustand = (store?.messages ?? []).filter(
      message => message.ruleId === '@typescript-eslint/no-restricted-imports',
    )
    expect(zustand).toEqual([])
  })

  it('restricts agent libraries, a type import included, but not a local module named ai', async () => {
    const { results } = await lint(root, preset)
    const agent = resultFor(results, 'src/agent.ts')
    const restricted = (agent?.messages ?? []).filter(
      message => message.ruleId === '@typescript-eslint/no-restricted-imports',
    )
    expect(restricted.map(message => message.line)).toEqual([1, 2, 3, 4, 5])
    expect(restricted[0]?.message).toContain('useAction()')
  })

  it('reports Widget-owned global effects only inside the declared Widget scope', async () => {
    const { results } = await lint(root, preset)
    const widget = resultFor(results, 'widgets/panel.ts')
    const effects = (widget?.messages ?? []).filter(
      message => message.ruleId === 'mfe/no-widget-global-effects',
    )
    expect(effects.length).toBe(2)

    const routes = resultFor(results, 'routes/index.ts')
    expect(
      (routes?.messages ?? []).filter(message => message.ruleId === 'mfe/no-widget-global-effects'),
    ).toEqual([])
  })

  it('reports nothing in a file that respects the boundaries', async () => {
    const { results } = await lint(root, preset)
    const clean = resultFor(results, 'src/clean.ts')
    expect(clean?.messages).toEqual([])
  })
})

/** A build config with an empty interface and a dropped promise, in one file. */
const TOOLING_SOURCE = `interface Base {
  name: string
}
export interface Config extends Base {}
export const config: Config = { name: 'x' }
export async function load(): Promise<void> {
  await Promise.resolve()
}
export function boot(): void {
  load()
}
`

describe('tooling preset, linting real files', () => {
  const root = makeProject({
    'vitest.config.ts': TOOLING_SOURCE,
    'vitest.setup.ts': `interface Matchers {
  toBeThing(): void
}
declare module 'test-runner' {
  interface Assertion extends Matchers {}
}
export const ready = true
`,
    // Named for the package it configures, not for a tool: the package's own preset owns it.
    'src/mfe.config.ts': TOOLING_SOURCE,
  })

  const preset = tooling({ tsconfigRootDir: root })

  it('runs without a configuration error and parses every file it claims', async () => {
    const summary = await lint(root, preset)
    expect(summary.fatal).toEqual([])
    expect(summary.unattributed).toEqual([])
    expect(summary.results.length).toBeGreaterThan(0)
  })

  it('applies the shared correctness layers to a build configuration file', async () => {
    const { results } = await lint(root, preset)
    const ruleIds = (resultFor(results, 'vitest.config.ts')?.messages ?? []).map(
      message => message.ruleId,
    )
    expect(ruleIds).toContain('@typescript-eslint/no-floating-promises')
    expect(ruleIds).toContain('@typescript-eslint/no-empty-object-type')
  })

  it('accepts the matcher augmentation a setup file has to declare', async () => {
    const { results } = await lint(root, preset)
    expect(resultFor(results, 'vitest.setup.ts')?.messages).toEqual([])
  })

  it('leaves a package source named `*.config.ts` to that package', async () => {
    const { results } = await lint(root, preset)
    const linted = results.map(result => result.filePath.split(sep).join('/'))
    expect(linted.some(path => path.endsWith('src/mfe.config.ts'))).toBe(false)
  })
})

const ANGULAR_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2023',
    lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    moduleDetection: 'force',
    strict: true,
    noUncheckedIndexedAccess: true,
    experimentalDecorators: true,
    useDefineForClassFields: false,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  },
  include: ['**/*.ts'],
})

/**
 * Faithful, minimal stand-ins for the slice of `@angular/core`/`@angular/router` the fixtures use.
 * The fixture project lives outside the workspace, so the real packages are not resolvable there;
 * an ambient `any` would defeat the point (every use would then itself be flagged `no-unsafe-*`),
 * so these keep real, narrow types instead.
 */
const ANGULAR_AMBIENT = `type Constructor<T> = new (...args: never[]) => T
declare module '@angular/core' {
  export function Component(metadata: {
    selector?: string
    template?: string
    templateUrl?: string
    changeDetection?: unknown
    imports?: readonly unknown[]
  }): ClassDecorator
  export class NgZone {}
  export function inject<T>(token: Constructor<T>): T
  export enum ChangeDetectionStrategy {
    OnPush = 0,
    Default = 1,
  }
}
declare module '@angular/router' {
  export class Router {
    navigate(commands: readonly unknown[]): Promise<boolean>
  }
}
declare module 'zone.js' {}
`

describe('angular preset, linting real files', () => {
  const root = makeProject({
    'src/ambient.d.ts': ANGULAR_AMBIENT,
    // A Widget: the adapter is zoneless, and the rule set should catch every one of these at once.
    'src/widgets/summary.component.ts': `import 'zone.js'
import { Component, NgZone, inject } from '@angular/core'
import { Router } from '@angular/router'

@Component({
  selector: 'summary-widget',
  template: \`<h1>{{ title }}</h1><input ([ngModel])="title" /> \`,
})
export class SummaryWidgetComponent {
  private readonly router = inject(Router)
  private readonly zone = inject(NgZone)

  open(): void {
    this.router.navigate(['/reports'])
    document.title = 'Reports'
    const prefs = localStorage.getItem('prefs')
    console.log(this.zone, prefs)
  }
}
`,
    // An App root: the same Router navigation is fine outside a declared Widget scope.
    'src/app/app-root.component.ts': `import { Component, inject } from '@angular/core'
import { Router } from '@angular/router'

@Component({
  selector: 'app-root',
  templateUrl: './app-root.html',
})
export class AppRootComponent {
  private readonly router = inject(Router)

  open(): void {
    this.router.navigate(['/reports'])
  }
}
`,
    // A real (non-inline) template file, with its own violation for the template parser to catch.
    'src/app/app-root.html': `<button type="button" (click)="open()">
  {{ 1 == 2 }}
</button>
`,
    'src/clean.component.ts': `import { ChangeDetectionStrategy, Component } from '@angular/core'

@Component({
  selector: 'clean-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<p>{{ total }}</p>',
})
export class CleanWidgetComponent {
  readonly total = 0
}
`,
  })
  writeFileSync(join(root, 'tsconfig.json'), ANGULAR_TSCONFIG)

  const preset = angular({
    tsconfigRootDir: root,
    files: ['src/**/*.ts'],
    widgetScopes: ['src/widgets/**'],
  })

  it('runs without a configuration error and parses every file it claims, templates included', async () => {
    const summary = await lint(root, preset)
    expect(summary.fatal).toEqual([])
    expect(summary.unattributed).toEqual([])
    expect(summary.results.length).toBeGreaterThan(0)
  })

  it('bans zone.js, NgZone and lets the Router-in-a-Widget rule fire, only inside the Widget scope', async () => {
    const { results } = await lint(root, preset)
    const widget = resultFor(results, 'src/widgets/summary.component.ts')
    const ruleIds = (widget?.messages ?? []).map(message => message.ruleId)
    expect(ruleIds).toContain('@typescript-eslint/no-restricted-imports')
    expect(ruleIds).toContain('mfe/no-widget-global-router')
    expect(ruleIds).toContain('mfe/no-widget-global-effects')
    expect(ruleIds).toContain('mfe/no-raw-storage')

    const restrictedImportCount = ruleIds.filter(
      ruleId => ruleId === '@typescript-eslint/no-restricted-imports',
    ).length
    // `zone.js`, and the named `NgZone` import off `@angular/core`.
    expect(restrictedImportCount).toBeGreaterThanOrEqual(2)

    const app = resultFor(results, 'src/app/app-root.component.ts')
    const appRuleIds = (app?.messages ?? []).map(message => message.ruleId)
    // The same Router navigation, outside the declared Widget scope, is not this rule's concern.
    expect(appRuleIds).not.toContain('mfe/no-widget-global-router')
  })

  it('extracts and lints the Widget’s inline template, catching the reversed banana in a box', async () => {
    const { results } = await lint(root, preset)
    const widget = resultFor(results, 'src/widgets/summary.component.ts')
    const ruleIds = (widget?.messages ?? []).map(message => message.ruleId)
    expect(ruleIds).toContain('@angular-eslint/template/banana-in-box')
  })

  it('lints a real (non-inline) template file with the angular-eslint template rules', async () => {
    const { results } = await lint(root, preset)
    const template = resultFor(results, 'src/app/app-root.html')
    const ruleIds = (template?.messages ?? []).map(message => message.ruleId)
    expect(ruleIds).toContain('@angular-eslint/template/eqeqeq')
  })

  it('reports nothing in a file that respects every boundary', async () => {
    const { results } = await lint(root, preset)
    const clean = resultFor(results, 'src/clean.component.ts')
    expect(clean?.messages).toEqual([])
  })
})
