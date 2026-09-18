/**
 * Installs jest-dom's matchers, and declares them, from this file's own vitest
 * instance. Both halves live here so they cannot drift: the shipped
 * `@testing-library/jest-dom/vitest` entry gets each one wrong in its own way.
 *
 * Runtime: that entry is CJS and calls `require('vitest').expect.extend(...)`,
 * which can resolve a second vitest instance. When it does, the `rejects` chain
 * lands on the other instance and `await expect(p).rejects.toThrow(/…/)` fails
 * with an empty message for any rejection — including a plain Error. Importing
 * the matchers and extending here keeps one instance.
 *
 * Types: that entry augments `interface Assertion<T = any>`, which was jest's
 * shape. Vitest 5 declares two type parameters, and declaration merging needs
 * them to match exactly, so the augmentation is silently dropped and every
 * matcher call is a type error at its call site rather than at the import. The
 * augmentation below matches vitest's signature — `R` is the return type, `T`
 * the asserted value — so it merges.
 */

import * as jestDom from '@testing-library/jest-dom/matchers'
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'
import { cleanup } from '@testing-library/react'

import { resetGeneratedAliases } from './src/testing/index.tsx'
import { afterEach, expect } from 'vitest'

declare module 'vitest' {
  interface Assertion<
    R extends void | Promise<void> = void,
    T = unknown,
  > extends TestingLibraryMatchers<T, R> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, void> {}
}

expect.extend(jestDom)

// Automatic cleanup after every test so no mount, root, subscription or
// registration leaks into the next one. The generated-alias fixtures are
// module state and would otherwise carry one test's configuration and request
// handler into the next.
afterEach(() => {
  cleanup()
  resetGeneratedAliases()
})
