/**
 * End-to-end lint of real files, for both presets. Asserting on the shape of a
 * config array is not enough: flat config resolves a rule's plugin from the
 * objects that match the file, so a preset can look complete and still fail the
 * moment ESLint is pointed at a file. These tests build a throwaway project on
 * disk and run `ESLint#lintFiles` over it.
 */

import { ESLint } from 'eslint'
import type { Linter } from 'eslint'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { author, framework } from '../index.ts'

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

/**
 * Source that trips `unbound-method`, `require-await`, `no-non-null-assertion`
 * and `no-floating-promises` — the four relaxed in test scope plus one that is
 * not.
 */
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

/** Every rule that reported, and every message ESLint could not attribute. */
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
  // A missing plugin, an unknown rule or a bad rule option throws from here
  // rather than showing up as a message, so reaching the assertions at all is
  // part of what this test checks.
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
    // Inside the caller's `files`, and inside a guarded package zone.
    'packages/mfe-core/src/leak.ts': `import { useState } from 'react'
export const hook = useState
`,
    'packages/mfe-host/src/boot.ts': `export async function load(): Promise<void> {
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
    // The same source twice: once as production code, once as a test. Only the
    // test copy gets the scoped exceptions, which is what makes them scoped.
    'packages/mfe-host/src/service.ts': SERVICE_SOURCE,
    'packages/mfe-host/src/service.test.ts': SERVICE_SOURCE,
    // A package with no React in it, whose bundler helper happens to be named
    // `use` — the loader key in an Rspack module rule. React's own rules read
    // any call to a function named `use` as the `use()` hook.
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
    'packages/mfe-host/src/clean.ts': `export function add(left: number, right: number): number {
  return left + right
}
`,
    // Deliberately outside the caller's `files`: a TypeScript file the preset
    // was never asked to cover. It must be left alone rather than linted
    // without a parser, which is the regression this fixture pins.
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
    // Type-aware typescript-eslint rules.
    expect([...ruleIds]).toContain('@typescript-eslint/no-floating-promises')
    // The package import DAG, as a restricted-imports zone.
    expect([...ruleIds]).toContain('@typescript-eslint/no-restricted-imports')
    // This plugin's own rules.
    expect([...ruleIds]).toContain('mfe/no-global-patching')
    expect([...ruleIds]).toContain('mfe/no-raw-storage')
    expect([...ruleIds]).toContain('mfe/stable-definitions')
    // React Hooks, which is where the React Compiler diagnostics live too.
    expect([...ruleIds]).toContain('react-hooks/rules-of-hooks')
  })

  it('leaves a TypeScript file outside the configured files untouched', async () => {
    const { results } = await lint(root, preset)
    const linted = results.map(result => result.filePath)
    expect(linted.some(path => path.endsWith('vitest.config.ts'))).toBe(false)
  })

  it('reports nothing in a file that respects the boundaries', async () => {
    const { results } = await lint(root, preset)
    const clean = results.find(result => result.filePath.endsWith('clean.ts'))
    expect(clean?.messages).toEqual([])
  })

  it('applies the test-scope exceptions in a test file', async () => {
    const { results } = await lint(root, preset)
    const test = results.find(result => result.filePath.endsWith('service.test.ts'))
    const ruleIds = (test?.messages ?? []).map(message => message.ruleId)
    expect(ruleIds).not.toContain('@typescript-eslint/unbound-method')
    expect(ruleIds).not.toContain('@typescript-eslint/require-await')
    expect(ruleIds).not.toContain('@typescript-eslint/no-non-null-assertion')
    // The rules that find real defects in a test are still on there.
    expect(ruleIds).toContain('@typescript-eslint/no-floating-promises')
  })

  it('applies the React rules everywhere by default, hook-shaped API and all', async () => {
    const { results } = await lint(root, preset)
    const plugin = results.find(result => result.filePath.endsWith('rspack/src/plugin.ts'))
    const ruleIds = (plugin?.messages ?? []).map(message => message.ruleId)
    // `rule.use(...)` is not a hook, but by default React rules apply here.
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

    const plugin = results.find(result => result.filePath.endsWith('rspack/src/plugin.ts'))
    const pluginRules = (plugin?.messages ?? []).map(message => message.ruleId ?? '')
    expect(pluginRules.filter(ruleId => ruleId.startsWith('react-hooks/'))).toEqual([])

    // The React package still gets them, and the rest of the preset still
    // applies to the non-React package.
    const react = results.find(result => result.filePath.endsWith('mfe-react/src/use-thing.ts'))
    expect((react?.messages ?? []).map(message => message.ruleId)).toContain(
      'react-hooks/rules-of-hooks',
    )
    const host = results.find(result => result.filePath.endsWith('mfe-host/src/boot.ts'))
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
    // zustand is an MFE author's business, and must not be restricted.
    'src/store.ts': `import { create } from 'zustand'
export const useStore = create
`,
    'src/boundaries.ts': `import type { MfeError } from '@company/mfe-core'
import { trace } from '@opentelemetry/api'
import { mountApp } from '@company/mfe-host/dist/mount.js'
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
    const boundaries = results.find(result => result.filePath.endsWith('boundaries.ts'))
    const restricted = (boundaries?.messages ?? []).filter(
      message => message.ruleId === '@typescript-eslint/no-restricted-imports',
    )
    // @company/mfe-core (a type-only import, still restricted), @opentelemetry/api
    // and the deep path into @company/mfe-host.
    expect(restricted.length).toBe(3)

    const store = results.find(result => result.filePath.endsWith('store.ts'))
    const zustand = (store?.messages ?? []).filter(
      message => message.ruleId === '@typescript-eslint/no-restricted-imports',
    )
    expect(zustand).toEqual([])
  })

  it('reports Widget-owned global effects only inside the declared Widget scope', async () => {
    const { results } = await lint(root, preset)
    const widget = results.find(result => result.filePath.endsWith('widgets/panel.ts'))
    const effects = (widget?.messages ?? []).filter(
      message => message.ruleId === 'mfe/no-widget-global-effects',
    )
    expect(effects.length).toBe(2)

    const routes = results.find(result => result.filePath.endsWith('routes/index.ts'))
    expect(
      (routes?.messages ?? []).filter(message => message.ruleId === 'mfe/no-widget-global-effects'),
    ).toEqual([])
  })

  it('reports nothing in a file that respects the boundaries', async () => {
    const { results } = await lint(root, preset)
    const clean = results.find(result => result.filePath.endsWith('src/clean.ts'))
    expect(clean?.messages).toEqual([])
  })
})
