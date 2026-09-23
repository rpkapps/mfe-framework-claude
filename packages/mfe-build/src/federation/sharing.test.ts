import { describe, expect, it } from 'vitest'

import {
  containerDependencies,
  isUsableVersionRange,
  resolveShared,
  SINGLETON,
  type SharingPolicies,
} from './sharing.ts'

/** An integration's policy: a runtime that must exist once, and libraries that may not. */
const POLICY: SharingPolicies = {
  'ui-runtime': SINGLETON,
  'ui-runtime-dom': SINGLETON,
  '@acme/ui-kit/': { singleton: false, strictVersion: false },
  charts: { singleton: false, strictVersion: false, eager: false },
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
    })
  })

  it('shares a candidate outside the policy as a singleton', () => {
    const shared = resolveShared({
      policy: POLICY,
      candidates: ['state-store'],
      dependencies: { 'state-store': '^2.0.0', 'ui-runtime': '^19.0.0' },
    })

    expect(Object.keys(shared)).toEqual(['state-store'])
    expect(shared['state-store']).toMatchObject({ singleton: true, strictVersion: true })
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
    })
  })

  it('disables the requirement explicitly when nothing is installed to read', () => {
    const shared = resolveShared({ policy: POLICY, dependencies: { 'ui-runtime': 'workspace:*' } })

    expect(shared['ui-runtime']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: false,
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
    })
  })

  it('omits the version on a prefix share when nothing is installed to read', () => {
    const shared = resolveShared({ policy: POLICY, dependencies: { '@acme/ui-kit': 'workspace:*' } })

    expect(shared['@acme/ui-kit/']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: false,
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
