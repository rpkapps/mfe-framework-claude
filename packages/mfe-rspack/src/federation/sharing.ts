/**
 * What a React container shares. An author can only add to it; a container that opted out of
 * sharing React would load a second one into a page that already has one, and no hook in it
 * would work.
 */

import { shared as designSystemShared } from '@tecton/react/federation/shared'

import { SINGLETON, type SharingPolicies, type SharingPolicy } from '@company/mfe-build/federation'

// These carry React context across the boundary, so a second copy makes every hook fail with
// "rendered outside any mount" while both copies look perfectly correct on their own.
const FRAMEWORK_POLICY: SharingPolicies = {
  '@company/mfe-core': SINGLETON,
  '@company/mfe-runtime': SINGLETON,
  '@company/mfe-react': SINGLETON,
  '@tanstack/react-router': SINGLETON,
  '@tanstack/react-query': SINGLETON,
}

// The library states its own contract; `strictVersion` is the one thing it leaves out, and a
// mismatch is an error exactly where a second copy would be.
const DESIGN_SYSTEM_POLICY: SharingPolicies = Object.fromEntries(
  Object.entries(designSystemShared).map(([name, policy]): [string, SharingPolicy] => [
    name,
    {
      singleton: policy.singleton,
      strictVersion: policy.singleton,
      ...(policy.eager === false ? { eager: false as const } : {}),
    },
  ]),
)

export const REACT_SHARING_POLICY: SharingPolicies = {
  ...FRAMEWORK_POLICY,
  ...DESIGN_SYSTEM_POLICY,
}

/** The candidates the adapter shares, each only when a container depends on it. */
export const DEFAULT_SHARED_CANDIDATES: readonly string[] = Object.keys(REACT_SHARING_POLICY)
