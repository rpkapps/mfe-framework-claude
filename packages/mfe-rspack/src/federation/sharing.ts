/**
 * What a React container shares. An author can only add to it; a container that opted out of
 * sharing React would always download a React of its own, even beside one its range accepts.
 */

import { shared as designSystemShared } from '@tecton/react/federation/shared'

import {
  FRAMEWORK_SCOPED,
  packageOf,
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

// These import React or carry its context, so each is shared only with containers on the same
// React version: a shared module's own imports resolve in the build that provided it. None is a
// singleton (§55). Inside `react@19.3.0` every container provides React 19.3.0, so React itself
// is one copy anyway; the rest resolve to the loaded copy a container's range accepts. React is
// listed here rather than left to the design system's contract, which also names it: whether
// React is shared is the adapter's decision, whatever a design system says.
//
// The adapter itself is not shared. It renders the providers the author's code reads, TanStack
// Query's client and the router, and a shared adapter would bind them to the copies the build
// that provided it resolved: a container whose range excluded those would find no `QueryClient`.
// Bundled, the adapter imports them through the container's own shares, as the author's code
// does. Nothing in it needs one copy per page: definitions and style roots are recognised by
// registered symbols, and each mount provides its contexts again in a root of its own.
const REACT_BOUND_POLICY: SharingPolicies = {
  react: FRAMEWORK_SCOPED,
  'react-dom': FRAMEWORK_SCOPED,
  '@tanstack/react-router': FRAMEWORK_SCOPED,
  '@tanstack/react-query': FRAMEWORK_SCOPED,
  // Only a bare specifier is a share key, so without these every container bundled its own copy
  // of the entry points a React build actually imports, and Rsbuild's `lib-react` chunk put each
  // copy beside react-dom's client: 69 KB gzipped per container, downloaded even when the host
  // had already provided React. A host provides the compiler runtime through
  // `@company/mfe-react/host`.
  'react/jsx-runtime': FRAMEWORK_SCOPED,
  'react/compiler-runtime': FRAMEWORK_SCOPED,
  'react-dom/client': FRAMEWORK_SCOPED,
}

/** The design system itself, which its contract offers to share and this adapter does not. */
const DESIGN_SYSTEM_PACKAGE = '@tecton/react'

// The library names what it shares, and whether it loads eagerly; its singleton flags are not
// read, because nothing is a singleton here. Every entry imports React, so a shared one's own
// React import resolves in whichever build provided it: all of them go in the React scope.
//
// The design system's own entry is left out. A shared module is neither tree-shaken nor merged
// into the chunks around it, so the prefix share split every component into chunks of its own;
// measured on every page, a container that bundles the components it imports mounted sooner on a
// cold load everywhere (the median page 16% sooner, 9% on a slow link, on a third of the JS
// requests) and broke even when navigating between applications. Nothing in it needs one copy
// per page: each container renders in a React root of its own, and the design system keeps no
// module state. What stays shared from it is its dependencies.
//
// What the adapter already decides is left out too, so the adapter's policy for React is the one
// that applies, and a contract that dropped React could not change it.
const DESIGN_SYSTEM_POLICY: SharingPolicies = Object.fromEntries(
  Object.entries(designSystemShared)
    .filter(([name]) => packageOf(name) !== DESIGN_SYSTEM_PACKAGE)
    .filter(([name]) => !Object.hasOwn(REACT_BOUND_POLICY, name))
    .map(([name, policy]): [string, SharingPolicy] => [
      name,
      {
        ...(policy.eager === false ? { eager: false as const } : {}),
        frameworkScoped: true,
      },
    ]),
)

/** React's own candidates; the build adds the page-wide ones to them, for a host as well. */
export const REACT_SHARING_POLICY: SharingPolicies = {
  ...REACT_BOUND_POLICY,
  ...DESIGN_SYSTEM_POLICY,
}

/** The candidates the adapter shares, each only when a container depends on it. */
export const DEFAULT_SHARED_CANDIDATES: readonly string[] = Object.keys(
  withPagePolicy(REACT_SHARING_POLICY),
)
