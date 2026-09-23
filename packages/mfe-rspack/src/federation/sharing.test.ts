import { describe, expect, it } from 'vitest'

import { resolveShared, type ResolveSharedOptions } from '@company/mfe-build/federation'

import { DEFAULT_SHARED_CANDIDATES, REACT_SHARING_POLICY } from './sharing.ts'

/** The machinery has its own tests in the build package; these are about what React shares. */
function resolveReactShared(options: Omit<ResolveSharedOptions, 'policy'>) {
  return resolveShared({ policy: REACT_SHARING_POLICY, ...options })
}

describe('the React sharing policy', () => {
  it('shares only the candidates the container actually depends on', () => {
    const shared = resolveReactShared({
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
    expect(resolveReactShared({ dependencies: { lodash: '^4.0.0' } })).toEqual({})
  })

  it("lists the framework's own candidates first, then the design system's contract in its order", () => {
    expect([...DEFAULT_SHARED_CANDIDATES]).toEqual([
      // A second copy of these makes every framework hook fail with "rendered outside any mount".
      '@company/mfe-core',
      '@company/mfe-runtime',
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

    const shared = resolveReactShared({
      dependencies: {
        '@company/mfe-core': 'workspace:*',
        '@company/mfe-runtime': 'workspace:*',
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
    const shared = resolveReactShared({
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

  it('shares the design system under the prefix its subpath imports use', () => {
    const shared = resolveReactShared({
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
    const shared = resolveReactShared({ dependencies: { '@tecton/react': 'workspace:*' } })

    expect(shared['@tecton/react/']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: false,
    })
    expect(shared['@tecton/react/']).not.toHaveProperty('version')
  })
})
