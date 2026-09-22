/**
 * Installs jest-dom's matchers, and declares them, from this project's own
 * vitest instance. Both halves live here so they cannot drift: the shipped
 * `@testing-library/jest-dom/vitest` entry gets each one wrong in its own way.
 *
 * Runtime: that entry is CJS and calls `require('vitest').expect.extend(...)`,
 * which can resolve a second vitest instance. When it does, the `rejects` chain
 * lands on the other one and `await expect(p).rejects.toThrow(/…/)` fails with
 * an empty message for every rejection, including a plain Error.
 *
 * Types: that entry augments `interface Assertion<T = any>`, which was jest's
 * shape. Vitest declares two type parameters, and declaration merging needs
 * them to match exactly, so the augmentation is dropped in silence and every
 * matcher call is a type error at its own call site. The declaration below
 * matches — `R` is the return type, `T` the asserted value — so it merges.
 * Listing the entry in a tsconfig `types` array does nothing for either half.
 */

import * as jestDom from '@testing-library/jest-dom/matchers'
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'
import { cleanup } from '@testing-library/react'
import { afterEach, expect } from 'vitest'

declare module 'vitest' {
  interface Assertion<
    R extends void | Promise<void> = void,
    T = unknown,
  > extends TestingLibraryMatchers<T, R> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, void> {}
}

expect.extend(jestDom)

// Nothing leaks from one test into the next.
afterEach(() => {
  cleanup()
})
