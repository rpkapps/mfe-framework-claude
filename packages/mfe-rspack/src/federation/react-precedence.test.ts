import { describe, expect, it, vi } from 'vitest'

import { resolveShared, withPagePolicy } from '@company/mfe-build/federation'

import { REACT_SHARING_POLICY } from './sharing.ts'

// A design-system contract that asks for singletons and leaves `react-dom` out, which the
// adapter's own policy has to overrule: whether React is shared is the adapter's decision, and
// nothing is a singleton whoever asks.
vi.mock('@tecton/react/federation/shared', () => ({
  shared: {
    react: { singleton: true },
    sonner: { singleton: true },
  },
}))

describe("the adapter's React policy", () => {
  it('shares React, react-dom and sonner in the React scope, none as a singleton', () => {
    const shared = resolveShared({
      policy: withPagePolicy(REACT_SHARING_POLICY),
      frameworkScope: 'react@19.3.0',
      dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', sonner: '^2.0.8' },
    })

    for (const name of ['react', 'react-dom']) {
      expect(shared[name], name).toEqual({
        singleton: false,
        strictVersion: false,
        requiredVersion: '^19.0.0',
        shareScope: 'react@19.3.0',
      })
    }
    expect(shared['sonner']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: '^2.0.8',
      shareScope: 'react@19.3.0',
    })
  })
})
