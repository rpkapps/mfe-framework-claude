/**
 * What a React container shares. An author can only add to it; a container that opted out of
 * sharing React would load a second one into a scope that already has one, and no hook in it
 * would work.
 */

import { shared as designSystemShared } from '@tecton/react/federation/shared'

import {
  packageOf,
  SINGLETON,
  withPagePolicy,
  type SharingPolicies,
  type SharingPolicy,
} from '@company/mfe-build/federation'

/** The adapter a React container imports the framework through. */
export const REACT_ADAPTER = '@company/mfe-react'

/** The name React's share scope starts with, and what a registry entry's `framework` says. */
export const REACT_FRAMEWORK = 'react'

/** The package whose installed version names the scope: `react@19.3.0`. */
export const REACT_ANCHOR = 'react'

// These carry React context across the boundary, so a second copy in one React version makes
// every hook fail with "rendered outside any mount" while both copies look correct on their own.
const REACT_BOUND_POLICY: SharingPolicies = {
  [REACT_ADAPTER]: SINGLETON,
  '@tanstack/react-router': SINGLETON,
  '@tanstack/react-query': SINGLETON,
  // Only a bare specifier is a share key, so without these every container bundled its own copy
  // of the entry points a React build actually imports, and Rsbuild's `lib-react` chunk put each
  // copy beside react-dom's client: 69 KB gzipped per container, downloaded even when the host
  // had already provided React. The compiler runtime reads React's internals, so it is as strict
  // as React itself; a host provides it through `@company/mfe-react/host`.
  'react/jsx-runtime': SINGLETON,
  'react/compiler-runtime': SINGLETON,
  'react-dom/client': SINGLETON,
}

/** The design system itself, which its contract offers to share and this adapter does not. */
const DESIGN_SYSTEM_PACKAGE = '@tecton/react'

// The library states its own contract; `strictVersion` is the one thing it leaves out, and a
// mismatch is an error exactly where a second copy would be. Every entry imports React, so a
// shared one's own React import resolves in whichever build provided it: all of them go in the
// React scope, singleton or not.
//
// The design system's own entry is left out. A shared module is neither tree-shaken nor merged
// into the chunks around it, so the prefix share split every component into chunks of its own;
// measured on every page, a container that bundles the components it imports mounted sooner on a
// cold load everywhere (the median page 16% sooner, 9% on a slow link, on a third of the JS
// requests) and broke even when navigating between applications. Nothing in it needs one copy
// per page: each container renders in a React root of its own, and the design system keeps no
// module state. Its dependencies that do stay shared: `sonner`'s toast queue above all.
const DESIGN_SYSTEM_POLICY: SharingPolicies = Object.fromEntries(
  Object.entries(designSystemShared)
    .filter(([name]) => packageOf(name) !== DESIGN_SYSTEM_PACKAGE)
    .map(([name, policy]): [string, SharingPolicy] => [
      name,
      {
        singleton: policy.singleton,
        strictVersion: policy.singleton,
        ...(policy.eager === false ? { eager: false as const } : {}),
        frameworkScoped: true,
      },
    ]),
)

/** React's own candidates; the build adds the page singletons to them, for a host as well. */
export const REACT_SHARING_POLICY: SharingPolicies = {
  ...REACT_BOUND_POLICY,
  ...DESIGN_SYSTEM_POLICY,
}

/** The candidates the adapter shares, each only when a container depends on it. */
export const DEFAULT_SHARED_CANDIDATES: readonly string[] = Object.keys(
  withPagePolicy(REACT_SHARING_POLICY),
)
