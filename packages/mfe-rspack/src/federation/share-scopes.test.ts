/**
 * What the share scopes buy, checked against Module Federation's own runtime rather than against
 * our reading of it: a host built with `hostShared`, containers built with the React policy on
 * two React versions, and the shell's federation loader registering each container from its
 * registry entry. Nothing is bundled; each container's remote entry is the smallest stand-in for
 * the one a build emits, initialised the way the bundler runtime initialises one, and each
 * package "copy" is an object whose identity says which build provided it.
 */

import { createInstance, type ModuleFederationRuntimePlugin } from '@module-federation/runtime'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveShared, shareScopesOf } from '@company/mfe-build/federation'
import { DEFINITION_BRAND } from '@company/mfe-core'
import { createFederationContainerLoader, parseFederatedEntry } from '@company/mfe-runtime'

import { hostShared, type SharedModuleConfig } from './host-shared.ts'
import { REACT_SHARING_POLICY } from './sharing.ts'

/** A module as one build provides it; two builds' copies are never the same object. */
interface Copy {
  readonly name: string
  readonly version: string
  readonly from: string
}

type RuntimeShared = NonNullable<Parameters<typeof createInstance>[0]['shared']>

/** Every package a container here uses, and what the host installed of each. */
const HOST_INSTALLED: Readonly<Record<string, string>> = {
  react: '19.3.0',
  'react-dom': '19.3.0',
  '@company/mfe-core': '0.1.0',
  '@company/mfe-runtime': '0.1.0',
  '@company/mfe-react': '0.1.0',
}
const PROBED = ['react', '@company/mfe-react', '@company/mfe-core'] as const

/** Module Federation keeps its instances and loaded entries on the global object. */
let run = 0
afterEach(() => {
  run += 1
})

/** What one build bundles of each package it shares. */
function copiesOf(
  from: string,
  shared: Readonly<Record<string, SharedModuleConfig>>,
  installed: Readonly<Record<string, string>>,
): Readonly<Record<string, Copy>> {
  return Object.fromEntries(
    Object.keys(shared).map(name => [name, { name, version: installed[name] ?? '0.0.0', from }]),
  )
}

/** The `shared` option a build hands the federation runtime, offering its own copies. */
function runtimeShared(
  shared: Readonly<Record<string, SharedModuleConfig>>,
  copies: Readonly<Record<string, Copy>>,
  provided: 'loaded' | 'on demand',
): RuntimeShared {
  return Object.fromEntries(
    Object.entries(shared).map(([name, config]) => {
      const copy = copies[name] as Copy
      const factory = () => copy
      return [
        name,
        {
          version: copy.version,
          scope: [config.shareScope],
          shareConfig: {
            singleton: config.singleton,
            strictVersion: config.strictVersion,
            requiredVersion: config.requiredVersion,
          },
          ...(provided === 'loaded' ? { lib: factory } : { get: () => Promise.resolve(factory) }),
        },
      ]
    }),
  )
}

interface ContainerBuild {
  readonly name: string
  readonly installed: Readonly<Record<string, string>>
  readonly shared: Readonly<Record<string, SharedModuleConfig>>
}

/** A React container as `pluginMfe()` plans its shares, at the React it installed. */
function reactContainer(name: string, react: string): ContainerBuild {
  const installed: Readonly<Record<string, string>> = {
    ...HOST_INSTALLED,
    react,
    'react-dom': react,
  }
  return {
    name,
    installed,
    shared: resolveShared({
      policy: REACT_SHARING_POLICY,
      dependencies: {
        react: 'catalog:',
        'react-dom': 'catalog:',
        '@company/mfe-react': 'workspace:*',
        '@company/mfe-core': 'workspace:*',
      },
      frameworkScope: `react@${react}`,
      installedVersion: packageName => installed[packageName],
    }),
  }
}

/** A container built before framework scopes: every share in `default`. */
function unscopedContainer(name: string, react: string): ContainerBuild {
  const scoped = reactContainer(name, react)
  return {
    ...scoped,
    shared: Object.fromEntries(
      Object.entries(scoped.shared).map(([key, config]) => [
        key,
        { ...config, shareScope: 'default' },
      ]),
    ),
  }
}

/**
 * The remote entry a build emits, reduced to what sharing needs: `init` links the scopes the host
 * registered it with, as the bundler runtime's `initContainerEntry` does for a container whose
 * own scope is `default`, and each probed import goes through `loadShare`, as a consumed shared
 * module does, falling back to the container's own copy.
 */
function remoteEntry(build: ContainerBuild) {
  const bundled = copiesOf(build.name, build.shared, build.installed)
  const own = runtimeShared(build.shared, bundled, 'on demand')
  // The container's own federation instance, which its build starts with its `shared` options.
  const remote = createInstance({
    name: build.name,
    remotes: [],
    shareStrategy: 'loaded-first',
    shared: own,
  })

  return {
    init(_shareScope: unknown, _initScope: unknown, options: Record<string, unknown>) {
      remote.initOptions({ name: build.name, remotes: [], ...options })
      const keys = options['shareScopeKeys'] as string | string[]
      const map = options['shareScopeMap'] as Record<string, Record<string, unknown>>
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        map[key] ??= {}
        remote.initShareScopeMap(key, map[key] as never, { hostShareScopeMap: map as never })
      }
    },
    async get() {
      const copies: Record<string, Copy> = {}
      for (const name of PROBED) {
        const factory = await remote.loadShare<Copy>(name, { customShareInfo: own[name] as never })
        // `false` is Module Federation's "nothing shared satisfies this": the build's own copy loads.
        copies[name] = (factory === false ? undefined : factory()) ?? (bundled[name] as Copy)
      }
      return () => ({
        definition: {
          [DEFINITION_BRAND]: true,
          kind: 'widget',
          id: build.name,
          framework: 'react',
          copies,
        },
      })
    },
  }
}

/** A registry entry as `tools/dev/build-registry.mjs` writes one from the build's descriptor. */
function registryEntry(build: ContainerBuild, shareScopes: 'published' | 'omitted') {
  return parseFederatedEntry(
    {
      id: build.name,
      kind: 'widget',
      mfe: { contractMajor: 1, framework: 'react' },
      manifestUrl: `https://cdn.example.test/${build.name}/remoteEntry.js`,
      container: build.name,
      expose: './widgets/probe',
      ...(shareScopes === 'published' ? { shareScopes: shareScopesOf(build.shared) } : {}),
    },
    'react',
  )
}

/**
 * The shell: a host instance sharing what `hostShared` resolves, with the federation loader the
 * shell boots with in front of it.
 */
function createPage(containers: readonly ContainerBuild[]) {
  const suffix = `_${String(run)}`
  const named = containers.map(build => ({ ...build, name: `${build.name}${suffix}` }))
  const remotes = new Map(named.map(build => [build.name, remoteEntry(build)]))

  const serveEntries: ModuleFederationRuntimePlugin = {
    name: 'serve-remote-entries',
    loadEntry: ({ remoteInfo }) => remotes.get(remoteInfo.name) as never,
  }
  const shared = hostShared({
    root: '/host-root-the-resolver-never-reads',
    installedVersion: packageName => HOST_INSTALLED[packageName],
  })
  const host = createInstance({
    name: `shell${suffix}`,
    remotes: [],
    shareStrategy: 'loaded-first',
    shared: runtimeShared(shared, copiesOf('shell', shared, HOST_INSTALLED), 'loaded'),
    plugins: [serveEntries],
  })

  const loader = createFederationContainerLoader({
    runtime: {
      registerRemotes: (entries, options) => {
        host.registerRemotes([...entries], options)
      },
      loadRemote: id => host.loadRemote(id),
    },
  })

  return {
    async copiesIn(name: string, shareScopes: 'published' | 'omitted' = 'published') {
      const build = named.find(candidate => candidate.name === `${name}${suffix}`)
      if (build === undefined) throw new Error(`no container ${name} on this page`)
      const loaded = await loader.load(registryEntry(build, shareScopes), {
        signal: new AbortController().signal,
      })
      return (loaded.module as unknown as { readonly copies: Record<string, Copy> }).copies
    },
  }
}

describe('framework share scopes under the Module Federation runtime', () => {
  it('gives every container on the host’s React the host’s React and adapter', async () => {
    const page = createPage([reactContainer('first', '19.3.0'), reactContainer('second', '19.3.0')])

    const first = await page.copiesIn('first')
    const second = await page.copiesIn('second')

    expect(first['react']).toMatchObject({ from: 'shell', version: '19.3.0' })
    expect(first['@company/mfe-react']).toMatchObject({ from: 'shell' })
    expect(second['react']).toBe(first['react'])
    expect(second['@company/mfe-react']).toBe(first['@company/mfe-react'])
  })

  it('gives a container on another React its own React and adapter, and the page’s core', async () => {
    const page = createPage([
      reactContainer('current', '19.3.0'),
      reactContainer('older', '19.2.8'),
    ])

    const current = await page.copiesIn('current')
    const older = await page.copiesIn('older')

    expect(older['react']).toMatchObject({ version: '19.2.8' })
    expect(older['react']?.from).toMatch(/^older/)
    expect(older['@company/mfe-react']?.from).toMatch(/^older/)
    expect(older['react']).not.toBe(current['react'])
    // One core for the whole page, whatever React a container renders with.
    expect(older['@company/mfe-core']).toMatchObject({ from: 'shell' })
    expect(older['@company/mfe-core']).toBe(current['@company/mfe-core'])
  })

  it('downloads one copy per React version, however many containers are on it', async () => {
    const page = createPage([reactContainer('left', '19.2.8'), reactContainer('right', '19.2.8')])

    const left = await page.copiesIn('left')
    const right = await page.copiesIn('right')

    expect(left['react']).toMatchObject({ version: '19.2.8' })
    expect(left['react']?.from).toMatch(/^left/)
    expect(right['react']).toBe(left['react'])
    expect(right['@company/mfe-react']).toBe(left['@company/mfe-react'])
  })

  it('keeps a container’s React private when it is registered without its framework scope', async () => {
    const page = createPage([reactContainer('unlinked', '19.3.0')])

    const copies = await page.copiesIn('unlinked', 'omitted')

    // A remote links only the scopes it is registered with, so the host's copy never reaches it.
    expect(copies['react']?.from).toMatch(/^unlinked/)
    expect(copies['@company/mfe-core']).toMatchObject({ from: 'shell' })
  })

  it('runs a container built before framework scopes on its own React and the page’s core', async () => {
    const page = createPage([unscopedContainer('legacy', '19.3.0')])

    const copies = await page.copiesIn('legacy', 'omitted')

    expect(copies['react']?.from).toMatch(/^legacy/)
    expect(copies['@company/mfe-core']).toMatchObject({ from: 'shell' })
  })
})
