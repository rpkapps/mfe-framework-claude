import { describe, expect, it } from 'vitest'

import {
  containerDependencies,
  frameworkShareScope,
  isUsableVersionRange,
  PAGE_POLICY,
  PAGE_SINGLETON,
  resolveShared as resolveSharedIn,
  shareScopesOf,
  SINGLETON,
  withPagePolicy,
  type ResolveSharedOptions,
  type SharingPolicies,
} from './sharing.ts'

/**
 * An integration's policy: a runtime that must exist once per framework version, libraries bound
 * to it that may exist more than once, and a neutral kernel the whole page shares.
 */
const POLICY: SharingPolicies = {
  'ui-runtime': SINGLETON,
  'ui-runtime-dom': SINGLETON,
  '@acme/ui-kit/': { singleton: false, strictVersion: false, frameworkScoped: true },
  charts: { singleton: false, strictVersion: false, eager: false, frameworkScoped: true },
  '@acme/kernel': PAGE_SINGLETON,
}

const FRAMEWORK_SCOPE = 'ui@19.3.0'

/** Every container here renders with the same made-up framework version. */
function resolveShared(options: Omit<ResolveSharedOptions, 'frameworkScope'>) {
  return resolveSharedIn({ frameworkScope: FRAMEWORK_SCOPE, ...options })
}

describe('resolveShared', () => {
  it('shares only the candidates the container actually depends on', () => {
    const shared = resolveShared({
      policy: POLICY,
      dependencies: { 'ui-runtime': '^19.0.0', 'ui-runtime-dom': '^19.0.0', lodash: '^4.0.0' },
    })

    expect(Object.keys(shared)).toEqual(['ui-runtime', 'ui-runtime-dom'])
    expect(shared['ui-runtime']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '^19.0.0',
      shareScope: FRAMEWORK_SCOPE,
    })
  })

  it('shares nothing when the container depends on none of them', () => {
    expect(resolveShared({ policy: POLICY, dependencies: { lodash: '^4.0.0' } })).toEqual({})
  })

  it('shares nothing at all under an empty policy, whatever the container depends on', () => {
    expect(resolveShared({ policy: {}, dependencies: { 'ui-runtime': '^19.0.0' } })).toEqual({})
  })

  it("applies each candidate's own policy, eager loading included", () => {
    const shared = resolveShared({
      policy: POLICY,
      dependencies: { charts: '3.8.0' },
    })

    expect(shared['charts']).toEqual({
      singleton: false,
      strictVersion: false,
      eager: false,
      requiredVersion: '3.8.0',
      shareScope: FRAMEWORK_SCOPE,
    })
  })

  it('shares a candidate outside the policy as a singleton', () => {
    const shared = resolveShared({
      policy: POLICY,
      candidates: ['state-store'],
      dependencies: { 'state-store': '^2.0.0', 'ui-runtime': '^19.0.0' },
    })

    expect(Object.keys(shared)).toEqual(['state-store'])
    expect(shared['state-store']).toMatchObject({
      singleton: true,
      strictVersion: true,
      shareScope: FRAMEWORK_SCOPE,
    })
  })

  it('keeps the defaults when an author adds a package', () => {
    const shared = resolveShared({
      policy: POLICY,
      dependencies: { 'ui-runtime': '^19.0.0' },
      overrides: { '@company/auth-client': '^3.0.0' },
    })

    expect(Object.keys(shared)).toEqual(['@company/auth-client', 'ui-runtime'])
    expect(shared['@company/auth-client']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '^3.0.0',
      shareScope: FRAMEWORK_SCOPE,
    })
    expect(shared['ui-runtime']?.requiredVersion).toBe('^19.0.0')
  })

  it('never relaxes a candidate an author names again', () => {
    const shared = resolveShared({
      policy: POLICY,
      dependencies: { charts: '3.8.0' },
      overrides: { charts: '^3.0.0' },
    })

    expect(shared['charts']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '^3.0.0',
      shareScope: FRAMEWORK_SCOPE,
    })
  })

  it('requires the version a workspace protocol resolved to', () => {
    const shared = resolveShared({
      policy: POLICY,
      dependencies: { 'ui-runtime': 'catalog:' },
      installedVersion: () => '19.3.0',
    })

    expect(shared['ui-runtime']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '19.3.0',
      shareScope: FRAMEWORK_SCOPE,
    })
  })

  it('disables the requirement explicitly when nothing is installed to read', () => {
    const shared = resolveShared({ policy: POLICY, dependencies: { 'ui-runtime': 'workspace:*' } })

    expect(shared['ui-runtime']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: false,
      shareScope: FRAMEWORK_SCOPE,
    })
  })

  it('keeps a declared range that a resolver can compare', () => {
    const shared = resolveShared({
      policy: POLICY,
      dependencies: { 'ui-runtime': '^19.0.0' },
      installedVersion: () => '19.3.0',
    })

    expect(shared['ui-runtime']?.requiredVersion).toBe('^19.0.0')
  })

  it('reads peer dependencies as well as dependencies', () => {
    const dependencies = containerDependencies({
      dependencies: { 'ui-runtime': '^19.0.0' },
      peerDependencies: { '@acme/ui-kit': '^3.0.0' },
    })

    expect(Object.keys(resolveShared({ policy: POLICY, dependencies }))).toEqual([
      '@acme/ui-kit/',
      'ui-runtime',
    ])
  })

  it('shares a library under the prefix its subpath imports use, stating what is installed', () => {
    const shared = resolveShared({
      policy: POLICY,
      dependencies: { '@acme/ui-kit': 'link:../ui-kit' },
      installedVersion: name => (name === '@acme/ui-kit' ? '0.4.0' : undefined),
    })

    expect(Object.keys(shared)).toEqual(['@acme/ui-kit/'])
    expect(shared['@acme/ui-kit/']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: '0.4.0',
      version: '0.4.0',
      shareScope: FRAMEWORK_SCOPE,
    })
  })

  it('omits the version on a prefix share when nothing is installed to read', () => {
    const shared = resolveShared({
      policy: POLICY,
      dependencies: { '@acme/ui-kit': 'workspace:*' },
    })

    expect(shared['@acme/ui-kit/']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: false,
      shareScope: FRAMEWORK_SCOPE,
    })
    expect(shared['@acme/ui-kit/']).not.toHaveProperty('version')
  })

  it('prefers the dependency range over the peer range for the same package', () => {
    const dependencies = containerDependencies({
      dependencies: { 'ui-runtime': '19.3.0' },
      peerDependencies: { 'ui-runtime': '^19.0.0' },
    })

    expect(resolveShared({ policy: POLICY, dependencies })['ui-runtime']?.requiredVersion).toBe(
      '19.3.0',
    )
  })
})

describe('framework share scopes', () => {
  it('puts every framework-bound candidate in the scope named after the framework version', () => {
    const shared = resolveSharedIn({
      policy: POLICY,
      dependencies: { 'ui-runtime': '19.3.0', '@acme/ui-kit': '^0.4.0', '@acme/kernel': '^1.0.0' },
      frameworkScope: frameworkShareScope('ui', '19.3.0'),
    })

    expect(shared['ui-runtime']?.shareScope).toBe('ui@19.3.0')
    expect(shared['@acme/ui-kit/']?.shareScope).toBe('ui@19.3.0')
    expect(shared['@acme/kernel']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '^1.0.0',
      shareScope: 'default',
    })
  })

  it('gives containers on another framework version a scope of their own', () => {
    const dependencies = { 'ui-runtime': 'catalog:', '@acme/kernel': 'workspace:*' }
    const at = (version: string) =>
      resolveSharedIn({
        policy: POLICY,
        dependencies,
        frameworkScope: frameworkShareScope('ui', version),
        installedVersion: name => (name === 'ui-runtime' ? version : '1.0.0'),
      })

    const current = at('19.3.0')
    const previous = at('19.2.8')

    expect(current['ui-runtime']).toMatchObject({
      shareScope: 'ui@19.3.0',
      requiredVersion: '19.3.0',
    })
    expect(previous['ui-runtime']).toMatchObject({
      shareScope: 'ui@19.2.8',
      requiredVersion: '19.2.8',
    })
    // The page singletons stay one copy whichever framework version a container is on.
    expect(previous['@acme/kernel']).toEqual(current['@acme/kernel'])
    expect(current['@acme/kernel']?.shareScope).toBe('default')
  })

  it('keeps a page singleton an author names again in the page scope', () => {
    const shared = resolveShared({
      policy: POLICY,
      dependencies: { '@acme/kernel': '^1.0.0' },
      overrides: { '@acme/kernel': '^1.2.0' },
    })

    expect(shared['@acme/kernel']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '^1.2.0',
      shareScope: 'default',
    })
  })

  it("adds an author's own package to the framework scope as a singleton", () => {
    const shared = resolveShared({
      policy: POLICY,
      dependencies: {},
      overrides: { '@acme/feature-flags': '^2.0.0' },
    })

    expect(shared['@acme/feature-flags']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '^2.0.0',
      shareScope: FRAMEWORK_SCOPE,
    })
  })
})

describe('the page singletons', () => {
  it('are the neutral core and runtime, shared page-wide', () => {
    expect(PAGE_POLICY).toEqual({
      '@company/mfe-core': PAGE_SINGLETON,
      '@company/mfe-runtime': PAGE_SINGLETON,
    })
  })

  it("join every integration's own candidates, ahead of them", () => {
    expect(Object.keys(withPagePolicy(POLICY))).toEqual([
      '@company/mfe-core',
      '@company/mfe-runtime',
      ...Object.keys(POLICY),
    ])
  })
})

describe('shareScopesOf', () => {
  it('lists the page scope first, then each other scope once', () => {
    const shared = resolveShared({
      policy: POLICY,
      dependencies: { 'ui-runtime': '^19.0.0', charts: '3.8.0', '@acme/kernel': '^1.0.0' },
    })

    expect(shareScopesOf(shared)).toEqual(['default', FRAMEWORK_SCOPE])
  })

  it('names the page scope even for a container that shares nothing in it', () => {
    const shared = resolveShared({ policy: POLICY, dependencies: { 'ui-runtime': '^19.0.0' } })

    expect(shareScopesOf(shared)).toEqual(['default', FRAMEWORK_SCOPE])
    expect(shareScopesOf({})).toEqual(['default'])
  })
})

describe('isUsableVersionRange', () => {
  it('accepts ordinary ranges', () => {
    expect(isUsableVersionRange('^19.0.0')).toBe(true)
    expect(isUsableVersionRange('19.3.0')).toBe(true)
  })

  it('rejects workspace protocols and wildcards', () => {
    for (const range of ['catalog:', 'workspace:*', 'link:../x', 'file:../x', '*', '']) {
      expect(isUsableVersionRange(range)).toBe(false)
    }
  })
})
