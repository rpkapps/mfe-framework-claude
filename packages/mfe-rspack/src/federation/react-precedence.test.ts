import { describe, expect, it, vi } from 'vitest'

import { resolveShared, withPagePolicy } from '@company/mfe-build/federation'

import { REACT_SHARING_POLICY } from './sharing.ts'

// A design-system contract that relaxes React and leaves `react-dom` out, which the adapter's own
// policy has to overrule: one React per scope is the adapter's requirement, not the library's.
vi.mock('@tecton/react/federation/shared', () => ({
  shared: {
    react: { singleton: false },
    sonner: { singleton: true },
  },
}))

describe("the adapter's React policy", () => {
  it('shares React and react-dom as strict singletons whatever the design system says', () => {
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
    expect(shared['sonner']).toMatchObject({ singleton: true, shareScope: 'react@19.3.0' })
  })
})
