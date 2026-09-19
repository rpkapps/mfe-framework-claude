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

  it('covers the framework, React, TanStack Router and Query, and the design system', () => {
    expect([...DEFAULT_SHARED_CANDIDATES]).toEqual([
      // The framework packages carry React context across the boundary; a
      // second copy makes every framework hook fail with "rendered outside any
      // mount", which is what a real federated page showed.
      '@company/mfe-core',
      '@company/mfe-host',
      '@company/mfe-react',
      'react',
      'react-dom',
      '@tanstack/react-router',
      '@tanstack/react-query',
      // The trailing slash is load-bearing: the design system publishes no
      // root entry, so every import of it is a subpath.
      '@tecton/react/',
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
        '@tecton/react': '^3.0.0',
      },
      installedVersion: () => '0.1.0',
    })

    expect(Object.keys(shared)).toHaveLength(8)
    for (const entry of Object.values(shared)) {
      expect(entry.singleton).toBe(true)
      expect(entry.strictVersion).toBe(true)
    }
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

  /**
   * A regression: this used to omit `requiredVersion` for a workspace
   * protocol, which reads as "no requirement" but is not. Module Federation
   * infers one from the nearest package.json when the field is absent, so the
   * container advertised that it required version "catalog:" and every shell
   * failed the check — which is exactly what happened the first time the shell
   * loaded a real container.
   */
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

  /**
   * The shell shares `@tecton/react/` and a container that shared the bare
   * specifier matched none of the subpath imports, so both sides believed they
   * were sharing the design system while the container bundled its own.
   */
  it('shares the design system under the prefix its subpath imports use', () => {
    const shared = resolveShared({
      dependencies: { '@tecton/react': 'link:../../../tecton-ui-1/packages/tecton-react' },
      installedVersion: () => '0.0.0',
    })

    expect(Object.keys(shared)).toEqual(['@tecton/react/'])
    expect(shared['@tecton/react/']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '0.0.0',
    })
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
