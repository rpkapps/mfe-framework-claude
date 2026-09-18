/**
 * Extends `expect` with jest-dom's matchers from this file's own vitest
 * instance.
 *
 * `@testing-library/jest-dom/vitest` is the usual entry, but it is CJS and
 * calls `require('vitest').expect.extend(...)`, which can resolve a second
 * vitest instance. When it does, the `rejects` chain lands on the other
 * instance and `await expect(p).rejects.toThrow(/…/)` fails with an empty
 * message for any rejection — including a plain Error. Importing the matchers
 * and extending here keeps one instance.
 */

import * as jestDom from '@testing-library/jest-dom/matchers'
import { cleanup } from '@testing-library/react'
import { afterEach, expect } from 'vitest'

expect.extend(jestDom)

// Automatic cleanup after every test so no mount, root, subscription or
// registration leaks into the next one.
afterEach(() => {
  cleanup()
})
