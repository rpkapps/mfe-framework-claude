import { describe, expect, it } from 'vitest'

import {
  containerDependencies,
  DEFAULT_SHARED_CANDIDATES,
  isUsableVersionRange,
  resolveShared,
} from './sharing.ts'

describe('resolveShared', () => {
  it('shares only the candidates the container actually depends on', () => {
    const shared = resolveShared({
      dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', lodash: '^4.0.0' },
    })

    expect(Object.keys(shared)).toEqual(['react', 'react-dom'])
    expect(shared['react']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '^19.0.0',
    })
  })

  it('shares nothing when the container depends on none of them', () => {
    expect(resolveShared({ dependencies: { lodash: '^4.0.0' } })).toEqual({})
  })

  it("lists the framework's own candidates first, then the design system's contract in its order", () => {
    expect([...DEFAULT_SHARED_CANDIDATES]).toEqual([
      // A second copy of these makes every framework hook fail with "rendered outside any mount".
      '@company/mfe-core',
      '@company/mfe-host',
      '@company/mfe-react',
      '@tanstack/react-router',
      '@tanstack/react-query',
      // Then `@tecton/react/federation/shared`, verbatim and in its own order.
      'react',
      'react-dom',
      'sonner',
      '@tecton/react/',
      'react-aria-components',
      'recharts',
    ])

    const shared = resolveShared({
      dependencies: {
        '@company/mfe-core': 'workspace:*',
        '@company/mfe-host': 'workspace:*',
        '@company/mfe-react': 'workspace:*',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        '@tanstack/react-router': '^1.170.0',
        '@tanstack/react-query': '^5.103.0',
        sonner: '^2.0.8',
      },
      installedVersion: () => '0.1.0',
    })

    expect(Object.keys(shared)).toHaveLength(8)
    for (const entry of Object.values(shared)) {
      expect(entry.singleton).toBe(true)
      expect(entry.strictVersion).toBe(true)
    }
  })

  it('shares the design system, React Aria and recharts as non-singletons', () => {
    const shared = resolveShared({
      dependencies: {
        '@tecton/react': 'link:../../../tecton-ui-1/packages/tecton-react',
        'react-aria-components': '^1.21.1',
        recharts: '3.8.0',
      },
      installedVersion: () => '0.1.0',
    })

    expect(shared['@tecton/react/']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: '0.1.0',
      version: '0.1.0',
    })
    expect(shared['react-aria-components']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: '^1.21.1',
    })
    expect(shared['recharts']).toEqual({
      singleton: false,
      strictVersion: false,
      eager: false,
      requiredVersion: '3.8.0',
    })
  })

  it('keeps the defaults when an author adds a package', () => {
    const shared = resolveShared({
      dependencies: { react: '^19.0.0' },
      overrides: { '@company/auth-client': '^3.0.0' },
    })

    expect(Object.keys(shared)).toEqual(['@company/auth-client', 'react'])
    expect(shared['@company/auth-client']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '^3.0.0',
    })
    expect(shared['react']?.requiredVersion).toBe('^19.0.0')
  })

  it('requires the version a workspace protocol resolved to', () => {
    const shared = resolveShared({
      dependencies: { react: 'catalog:' },
      installedVersion: () => '19.3.0',
    })

    expect(shared['react']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '19.3.0',
    })
  })

  it('disables the requirement explicitly when nothing is installed to read', () => {
    const shared = resolveShared({ dependencies: { react: 'workspace:*' } })

    expect(shared['react']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: false,
    })
  })

  it('keeps a declared range that a resolver can compare', () => {
    const shared = resolveShared({
      dependencies: { react: '^19.0.0' },
      installedVersion: () => '19.3.0',
    })

    expect(shared['react']?.requiredVersion).toBe('^19.0.0')
  })

  it('reads peer dependencies as well as dependencies', () => {
    const dependencies = containerDependencies({
      dependencies: { react: '^19.0.0' },
      peerDependencies: { '@tecton/react': '^3.0.0' },
    })

    expect(Object.keys(resolveShared({ dependencies }))).toEqual(['@tecton/react/', 'react'])
  })

  it('shares the design system under the prefix its subpath imports use', () => {
    const shared = resolveShared({
      dependencies: { '@tecton/react': 'link:../../../tecton-ui-1/packages/tecton-react' },
      installedVersion: () => '0.0.0',
    })

    expect(Object.keys(shared)).toEqual(['@tecton/react/'])
    expect(shared['@tecton/react/']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: '0.0.0',
      version: '0.0.0',
    })
  })

  it('omits the version on a prefix share when nothing is installed to read', () => {
    const shared = resolveShared({ dependencies: { '@tecton/react': 'workspace:*' } })

    expect(shared['@tecton/react/']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: false,
    })
    expect(shared['@tecton/react/']).not.toHaveProperty('version')
  })

  it('prefers the dependency range over the peer range for the same package', () => {
    const dependencies = containerDependencies({
      dependencies: { react: '19.3.0' },
      peerDependencies: { react: '^19.0.0' },
    })

    expect(resolveShared({ dependencies })['react']?.requiredVersion).toBe('19.3.0')
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
