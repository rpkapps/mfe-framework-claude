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

import { resolveShared, shareScopesOf, withPagePolicy } from '@company/mfe-build/federation'
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
  '@tanstack/react-query': '5.103.0',
}
const PROBED = ['react', '@tanstack/react-query', '@company/mfe-core'] as const

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

/**
 * A React container as `pluginMfe()` plans its shares, at the React it installed. By default it
 * was built in the host's workspace; a container from a repository of its own names the versions
 * it installed and the ranges it declared.
 */
function reactContainer(
  name: string,
  react: string,
  own: {
    readonly installed?: Readonly<Record<string, string>>
    readonly dependencies?: Readonly<Record<string, string>>
  } = {},
): ContainerBuild {
  const installed: Readonly<Record<string, string>> = {
    ...HOST_INSTALLED,
    react,
    'react-dom': react,
    ...own.installed,
  }
  return {
    name,
    installed,
    shared: resolveShared({
      policy: withPagePolicy(REACT_SHARING_POLICY),
      dependencies: {
        react: 'catalog:',
        'react-dom': 'catalog:',
        '@company/mfe-react': 'workspace:*',
        '@company/mfe-core': 'workspace:*',
        '@tanstack/react-query': 'catalog:',
        ...own.dependencies,
      },
      frameworkScope: `react@${react}`,
      installedVersion: packageName => installed[packageName],
    }),
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
  it('gives every container on the host’s React the host’s React and TanStack Query', async () => {
    const page = createPage([reactContainer('first', '19.3.0'), reactContainer('second', '19.3.0')])

    const first = await page.copiesIn('first')
    const second = await page.copiesIn('second')

    expect(first['react']).toMatchObject({ from: 'shell', version: '19.3.0' })
    expect(first['@tanstack/react-query']).toMatchObject({ from: 'shell' })
    expect(second['react']).toBe(first['react'])
    expect(second['@tanstack/react-query']).toBe(first['@tanstack/react-query'])
  })

  it('gives a container on another React its own React and TanStack Query, and the page’s core', async () => {
    const page = createPage([
      reactContainer('current', '19.3.0'),
      reactContainer('older', '19.2.8'),
    ])

    const current = await page.copiesIn('current')
    const older = await page.copiesIn('older')

    expect(older['react']).toMatchObject({ version: '19.2.8' })
    expect(older['react']?.from).toMatch(/^older/)
    expect(older['@tanstack/react-query']?.from).toMatch(/^older/)
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
    expect(right['@tanstack/react-query']).toBe(left['@tanstack/react-query'])
  })

  it('keeps a container’s React private when it is registered without its framework scope', async () => {
    const page = createPage([reactContainer('unlinked', '19.3.0')])

    const copies = await page.copiesIn('unlinked', 'omitted')

    // A remote links only the scopes it is registered with, so the host's copy never reaches it.
    expect(copies['react']?.from).toMatch(/^unlinked/)
    expect(copies['@company/mfe-core']).toMatchObject({ from: 'shell' })
  })

  it('gives a container on a newer TanStack Query than the host its own rather than failing to load', async () => {
    const page = createPage([
      reactContainer('ahead', '19.3.0', {
        installed: { '@tanstack/react-query': '6.0.0' },
        dependencies: { '@tanstack/react-query': '^6.0.0' },
      }),
    ])

    const copies = await page.copiesIn('ahead')

    // Nothing is a singleton, so a range the loaded copy misses falls back instead of throwing.
    expect(copies['@tanstack/react-query']).toMatchObject({ version: '6.0.0' })
    expect(copies['@tanstack/react-query']?.from).toMatch(/^ahead/)
    // React is still the host's: in `react@19.3.0` every copy is React 19.3.0.
    expect(copies['react']).toMatchObject({ from: 'shell' })
  })

  it('gives a container whose range accepts the host’s copy that copy, whatever it installed', async () => {
    const page = createPage([
      reactContainer('compatible', '19.3.0', {
        installed: { '@tanstack/react-query': '5.110.0', '@company/mfe-core': '0.1.4' },
        dependencies: { '@tanstack/react-query': '^5.100.0', '@company/mfe-core': '^0.1.0' },
      }),
    ])

    const copies = await page.copiesIn('compatible')

    expect(copies['@tanstack/react-query']).toMatchObject({ from: 'shell', version: '5.103.0' })
    expect(copies['@company/mfe-core']).toMatchObject({ from: 'shell', version: '0.1.0' })
  })

  it('gives a container on a core the host’s does not satisfy a core of its own', async () => {
    const page = createPage([
      reactContainer('current', '19.3.0'),
      reactContainer('newer-core', '19.3.0', {
        installed: { '@company/mfe-core': '0.2.0' },
        dependencies: { '@company/mfe-core': '^0.2.0' },
      }),
    ])

    const current = await page.copiesIn('current')
    const newer = await page.copiesIn('newer-core')

    // Two cores on one page, which is why nothing in the core may rely on being the only one.
    expect(newer['@company/mfe-core']?.from).toMatch(/^newer-core/)
    expect(newer['@company/mfe-core']).not.toBe(current['@company/mfe-core'])
  })
})
