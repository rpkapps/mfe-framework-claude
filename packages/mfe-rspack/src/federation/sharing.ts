/**
 * What a React container shares. An author can only add to it; a container that opted out of
 * sharing React would load a second one into a scope that already has one, and no hook in it
 * would work.
 */

import { shared as designSystemShared } from '@tecton/react/federation/shared'

import {
  PAGE_SINGLETON,
  SINGLETON,
  type SharingPolicies,
  type SharingPolicy,
} from '@company/mfe-build/federation'

/** The adapter a React container imports the framework through. */
export const REACT_ADAPTER = '@company/mfe-react'

/** The name React's share scope starts with, and what a registry entry's `framework` says. */
export const REACT_FRAMEWORK = 'react'

/** The package whose installed version names the scope: `react@19.3.0`. */
export const REACT_ANCHOR = 'react'

// The mount-token sequence and the `instanceof` checks errors and spans are recognised by are
// module state in these, and neither imports a framework, so the whole page shares one copy.
const PAGE_POLICY: SharingPolicies = {
  '@company/mfe-core': PAGE_SINGLETON,
  '@company/mfe-runtime': PAGE_SINGLETON,
}

// These carry React context across the boundary, so a second copy in one React version makes
// every hook fail with "rendered outside any mount" while both copies look correct on their own.
const REACT_BOUND_POLICY: SharingPolicies = {
  [REACT_ADAPTER]: SINGLETON,
  '@tanstack/react-router': SINGLETON,
  '@tanstack/react-query': SINGLETON,
}

// The library states its own contract; `strictVersion` is the one thing it leaves out, and a
// mismatch is an error exactly where a second copy would be. Every entry imports React, so a
// shared one's own React import resolves in whichever build provided it: all of them go in the
// React scope, singleton or not.
const DESIGN_SYSTEM_POLICY: SharingPolicies = Object.fromEntries(
  Object.entries(designSystemShared).map(([name, policy]): [string, SharingPolicy] => [
    name,
    {
      singleton: policy.singleton,
      strictVersion: policy.singleton,
      ...(policy.eager === false ? { eager: false as const } : {}),
      frameworkScoped: true,
    },
  ]),
)

export const REACT_SHARING_POLICY: SharingPolicies = {
  ...PAGE_POLICY,
  ...REACT_BOUND_POLICY,
  ...DESIGN_SYSTEM_POLICY,
}

/** The candidates the adapter shares, each only when a container depends on it. */
export const DEFAULT_SHARED_CANDIDATES: readonly string[] = Object.keys(REACT_SHARING_POLICY)
