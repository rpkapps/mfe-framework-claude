import { describe, expect, it, vi } from 'vitest'

import { resolveShared, withPagePolicy } from '@company/mfe-build/federation'

import { REACT_SHARING_POLICY } from './sharing.ts'

// A design-system contract that relaxes React and `sonner` and leaves `react-dom` out, as one
// written for applications that share no scope does, which the adapter's own policy has to
// overrule: one React and one toast queue per scope is the adapter's requirement, not the library's.
vi.mock('@tecton/react/federation/shared', () => ({
  shared: {
    react: { singleton: false },
    sonner: { singleton: false },
  },
}))

describe("the adapter's React policy", () => {
  it('shares React, react-dom and sonner as strict singletons whatever the design system says', () => {
    const shared = resolveShared({
      policy: withPagePolicy(REACT_SHARING_POLICY),
      frameworkScope: 'react@19.3.0',
      dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', sonner: '^2.0.8' },
    })

    for (const name of ['react', 'react-dom']) {
      expect(shared[name], name).toEqual({
        singleton: true,
        strictVersion: true,
        requiredVersion: '^19.0.0',
        shareScope: 'react@19.3.0',
      })
    }
    expect(shared['sonner']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '^2.0.8',
      shareScope: 'react@19.3.0',
    })
  })
})
