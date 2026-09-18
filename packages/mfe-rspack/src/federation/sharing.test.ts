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

  it('covers React, TanStack Router and Query, and the design system', () => {
    expect([...DEFAULT_SHARED_CANDIDATES]).toEqual([
      'react',
      'react-dom',
      '@tanstack/react-router',
      '@tanstack/react-query',
      '@tecton/react',
    ])

    const shared = resolveShared({
      dependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        '@tanstack/react-router': '^1.170.0',
        '@tanstack/react-query': '^5.103.0',
        '@tecton/react': '^3.0.0',
      },
    })

    expect(Object.keys(shared)).toHaveLength(5)
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

  it('omits a required version a resolver could not compare', () => {
    const shared = resolveShared({ dependencies: { react: 'catalog:' } })

    expect(shared['react']).toEqual({ singleton: true, strictVersion: true })
  })

  it('reads peer dependencies as well as dependencies', () => {
    const dependencies = containerDependencies({
      dependencies: { react: '^19.0.0' },
      peerDependencies: { '@tecton/react': '^3.0.0' },
    })

    expect(Object.keys(resolveShared({ dependencies }))).toEqual(['@tecton/react', 'react'])
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
