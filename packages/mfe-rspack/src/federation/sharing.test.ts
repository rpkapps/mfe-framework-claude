import { describe, expect, it } from 'vitest'

import { resolveShared, type ResolveSharedOptions } from '@company/mfe-build/federation'

import { DEFAULT_SHARED_CANDIDATES, REACT_SHARING_POLICY } from './sharing.ts'

const REACT_SCOPE = 'react@19.3.0'

/** The machinery has its own tests in the build package; these are about what React shares. */
function resolveReactShared(options: Omit<ResolveSharedOptions, 'policy' | 'frameworkScope'>) {
  return resolveShared({ policy: REACT_SHARING_POLICY, frameworkScope: REACT_SCOPE, ...options })
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
      shareScope: REACT_SCOPE,
    })
  })

  it('shares nothing when the container depends on none of them', () => {
    expect(resolveReactShared({ dependencies: { lodash: '^4.0.0' } })).toEqual({})
  })

  it("lists the framework's own candidates first, then the design system's contract in its order", () => {
    expect([...DEFAULT_SHARED_CANDIDATES]).toEqual([
      // One copy per page, whatever framework renders.
      '@company/mfe-core',
      '@company/mfe-runtime',
      // A second copy of these in one React version makes every framework hook fail with
      // "rendered outside any mount".
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

  it('keeps the neutral core and runtime page-wide and puts everything React-bound in the React scope', () => {
    const shared = resolveReactShared({
      dependencies: Object.fromEntries(
        DEFAULT_SHARED_CANDIDATES.map(candidate => [candidate.replace(/\/$/, ''), '1.0.0']),
      ),
    })

    const scopes = Object.fromEntries(
      Object.entries(shared).map(([name, entry]) => [name, entry.shareScope]),
    )
    expect(scopes).toEqual({
      '@company/mfe-core': 'default',
      '@company/mfe-runtime': 'default',
      '@company/mfe-react': REACT_SCOPE,
      '@tanstack/react-query': REACT_SCOPE,
      '@tanstack/react-router': REACT_SCOPE,
      '@tecton/react/': REACT_SCOPE,
      react: REACT_SCOPE,
      'react-aria-components': REACT_SCOPE,
      'react-dom': REACT_SCOPE,
      recharts: REACT_SCOPE,
      sonner: REACT_SCOPE,
    })
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
      shareScope: REACT_SCOPE,
    })
    expect(shared['react-aria-components']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: '^1.21.1',
      shareScope: REACT_SCOPE,
    })
    expect(shared['recharts']).toEqual({
      singleton: false,
      strictVersion: false,
      eager: false,
      requiredVersion: '3.8.0',
      shareScope: REACT_SCOPE,
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
      shareScope: REACT_SCOPE,
    })
  })

  it('omits the version on a prefix share when nothing is installed to read', () => {
    const shared = resolveReactShared({ dependencies: { '@tecton/react': 'workspace:*' } })

    expect(shared['@tecton/react/']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: false,
      shareScope: REACT_SCOPE,
    })
    expect(shared['@tecton/react/']).not.toHaveProperty('version')
  })

  it('never moves the neutral core into the React scope when an author names it again', () => {
    const shared = resolveReactShared({
      dependencies: { '@company/mfe-core': '^0.1.0' },
      overrides: { '@company/mfe-core': '^0.1.2', '@acme/auth-client': '^3.0.0' },
    })

    expect(shared['@company/mfe-core']).toMatchObject({
      singleton: true,
      requiredVersion: '^0.1.2',
      shareScope: 'default',
    })
    expect(shared['@acme/auth-client']).toMatchObject({ singleton: true, shareScope: REACT_SCOPE })
  })
})
