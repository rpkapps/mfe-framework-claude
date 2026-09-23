/**
 * The helper against a stand-in for the hook subset webpack and Rspack share; the integrations'
 * own suites compile real containers with it.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  applyContainerCompilation,
  type BundlerCompilation,
  type BundlerCompiler,
  type ContainerCompilationOptions,
} from './compilation.ts'
import { seedLocalRuntimeConfig } from './generate/runtime-config.ts'
import type { ContainerOptions } from './options.ts'
import { createContainerPlanner, type ContainerPlan } from './plan.ts'
import { cleanupContainers, createContainer } from './testing/fixtures.ts'
import { TEST_PROFILE } from './testing/profile.ts'

afterEach(cleanupContainers)

const ENTRY = `
import { createApp } from '@acme/mfe-adapter'
import { routes } from './routes.ts'

export const operations = createApp({ id: 'operations', routes })
`

const CONFIG = `
import { env } from '@acme/mfe-plugin'
import { z } from 'zod'

export default {
  pageSize: env('PAGE_SIZE', z.number().int().default(25)),
}
`

class TextSource {
  constructor(readonly text: string) {}

  source(): string {
    return this.text
  }
}

class TaggedError extends Error {
  constructor(readonly finding: Error) {
    super(finding.message)
  }
}

interface Compiled {
  readonly assets: Readonly<Record<string, string>>
  readonly errors: readonly TaggedError[]
}

/** A compiler that runs each compile's hooks in order, over the assets the bundler emitted. */
function standInCompiler(mode: 'production' | 'development') {
  const beforeCompile: (() => void)[] = []
  const thisCompilation: ((compilation: BundlerCompilation<TextSource, TaggedError>) => void)[] = []

  const compiler: BundlerCompiler<TextSource, TaggedError> = {
    options: { mode },
    hooks: {
      beforeCompile: { tap: (_name, callback) => beforeCompile.push(callback) },
      thisCompilation: { tap: (_name, callback) => thisCompilation.push(callback) },
    },
    webpack: {
      Compilation: { PROCESS_ASSETS_STAGE_DERIVED: 1, PROCESS_ASSETS_STAGE_REPORT: 2 },
      sources: { RawSource: TextSource },
    },
  }

  const compile = (emitted: Readonly<Record<string, string>> = {}): Compiled => {
    for (const callback of beforeCompile) callback()

    const assets = new Map(
      Object.entries(emitted).map(([name, text]) => [name, new TextSource(text)]),
    )
    const stages: { readonly stage: number; readonly callback: () => void }[] = []
    const errors: TaggedError[] = []
    const compilation: BundlerCompilation<TextSource, TaggedError> = {
      errors,
      hooks: { processAssets: { tap: ({ stage }, callback) => stages.push({ stage, callback }) } },
      getAsset: name => {
        const source = assets.get(name)
        return source === undefined ? undefined : { source }
      },
      emitAsset: (name, source) => assets.set(name, source),
      updateAsset: (name, source) => assets.set(name, source),
    }

    for (const callback of thisCompilation) callback(compilation)
    for (const { callback } of stages.sort((left, right) => left.stage - right.stage)) callback()

    return {
      assets: Object.fromEntries([...assets].map(([name, source]) => [name, source.text])),
      errors,
    }
  }

  return { compiler, compile }
}

function containerPlanner(
  files: Readonly<Record<string, string>> = {},
  options: Pick<ContainerOptions, 'runtimeConfigFileName'> = {},
) {
  const root = createContainer({ 'src/mfe.ts': ENTRY, 'src/mfe.config.ts': CONFIG, ...files })
  const planner = createContainerPlanner(TEST_PROFILE, { ...options, containerRoot: root })
  let replans = 0
  const replan = (): ContainerPlan => {
    replans += 1
    return planner()
  }
  return { root, plan: planner(), replan, replans: () => replans }
}

function applied(
  mode: 'production' | 'development',
  planner: ReturnType<typeof containerPlanner>,
  options: Partial<ContainerCompilationOptions<ContainerPlan, TaggedError>> = {},
) {
  const { compiler, compile } = standInCompiler(mode)
  const currentPlan = applyContainerCompilation(compiler, {
    name: 'AcmePlugin',
    plan: planner.plan,
    replan: planner.replan,
    toError: finding => new TaggedError(finding),
    federationRepair: 'Check that acmeMfe() is still applied.',
    ...options,
  })
  return { compile, currentPlan }
}

const MANIFEST = '{ "metaData": { "name": "acme_operations" } }'

/** Seeds the developer's copy wherever the generate step keeps it, then edits in a laptop's value. */
function giveLocalValues(plan: ContainerPlan): void {
  const local = seedLocalRuntimeConfig(plan)
  if (local === null) throw new Error('The fixture declares no configuration to seed.')
  writeFileSync(local.path, '{ "apiBaseUrl": "http://localhost:3010/api/" }\n')
}

/** What a bundler copies from `public/` beside the compiled output, as it emits it. */
function copiedPublicDir(root: string): Record<string, string> {
  const publicDir = join(root, 'public')
  if (!existsSync(publicDir)) return {}
  return Object.fromEntries(
    readdirSync(publicDir, { recursive: true, encoding: 'utf8' })
      .filter(name => statSync(join(publicDir, name)).isFile())
      .map(name => [name.split(sep).join('/'), readFileSync(join(publicDir, name), 'utf8')]),
  )
}

describe('applyContainerCompilation', () => {
  it('writes the configured plan, then plans again before every compile but the first', () => {
    const planner = containerPlanner()
    const { compile, currentPlan } = applied('production', planner)

    expect(existsSync(join(planner.root, '.mfe/meta.ts'))).toBe(true)
    compile({ 'mf-manifest.json': MANIFEST })
    expect(planner.replans()).toBe(0)
    expect(currentPlan()).toBe(planner.plan)

    compile({ 'mf-manifest.json': MANIFEST })
    compile({ 'mf-manifest.json': MANIFEST })
    expect(planner.replans()).toBe(2)
    expect(currentPlan()).not.toBe(planner.plan)
  })

  it("reports the plan's findings as the bundler's own errors", () => {
    const planner = containerPlanner({ 'src/logo.ts': "export const logo = './logo.svg'\n" })
    const { compile } = applied('production', planner)

    const { errors } = compile({ 'mf-manifest.json': MANIFEST })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.finding).toBe(planner.plan.diagnostics[0])
  })

  it('ships the files the generator names as assets, and nothing else it generated', () => {
    const { compile } = applied('development', containerPlanner())

    const { assets } = compile({ 'mf-manifest.json': MANIFEST })

    expect(Object.keys(assets).sort()).toEqual([
      'mf-manifest.json',
      'mfe-registry.json',
      'runtime-config.schema.json',
    ])
  })

  it('ships the declared defaults as the runtime configuration of a production compile', () => {
    const { compile } = applied('production', containerPlanner())

    const { assets } = compile({ 'mf-manifest.json': MANIFEST })

    expect(JSON.parse(assets['runtime-config.json'] ?? 'null')).toEqual({ pageSize: 25 })
  })

  it.each([
    { named: 'runtime-config.json', options: {} },
    { named: 'settings.json', options: { runtimeConfigFileName: 'settings.json' } },
  ])(
    "ships the declared defaults as $named, and none of the developer's values",
    ({ named, options }) => {
      const planner = containerPlanner({ 'public/robots.txt': 'User-agent: *\n' }, options)
      giveLocalValues(planner.plan)

      const { assets } = applied('production', planner).compile({
        'mf-manifest.json': MANIFEST,
        ...copiedPublicDir(planner.root),
      })

      expect(JSON.parse(assets[named] ?? 'null')).toEqual({ pageSize: 25 })
      expect(assets['robots.txt']).toBe('User-agent: *\n')
      expect(Object.values(assets).join('\n')).not.toContain('localhost')
    },
  )

  it('stamps the framework metadata into the federation manifest, keeping what it held', () => {
    const planner = containerPlanner()
    const { compile } = applied('production', planner)

    const { assets } = compile({ 'mf-manifest.json': MANIFEST })

    const manifest = JSON.parse(assets['mf-manifest.json'] ?? 'null') as {
      metaData: Record<string, unknown>
    }
    expect(manifest.metaData['name']).toBe('acme_operations')
    expect(manifest.metaData['mfe']).toEqual(planner.plan.generated.frameworkMetadata)
  })

  it('names what should have emitted the federation manifest when none was', () => {
    const { compile } = applied('production', containerPlanner())

    const { errors } = compile()

    expect(errors.map(error => error.message)).toEqual([
      'AcmePlugin: no mf-manifest.json was emitted, so this container declares no framework ' +
        'contract and a shell cannot tell which major it was built against. Check that acmeMfe() ' +
        'is still applied.',
    ])
  })
})
