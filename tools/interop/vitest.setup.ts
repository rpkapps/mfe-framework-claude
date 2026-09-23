/**
 * Both adapters render in one test here, so the setup is both adapters' setups at once. The
 * Angular definitions are compiled just in time, which needs the compiler loaded before the first
 * component is created; there is no zone setup, because every Angular mount is zoneless.
 *
 * jest-dom's matchers are installed from this file's own vitest instance and declared with
 * vitest's own `Assertion` signature, for the reasons `packages/mfe-react/vitest.setup.ts` gives:
 * the shipped `@testing-library/jest-dom/vitest` entry can extend a second vitest instance, and its
 * type augmentation does not merge with vitest 5's.
 */

import '@angular/compiler'

import { cleanup as cleanupAngularHosts } from '@company/mfe-angular/testing'
import * as jestDom from '@testing-library/jest-dom/matchers'
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'
import { cleanup as cleanupReactTrees } from '@testing-library/react'
import { afterEach, expect } from 'vitest'

declare module 'vitest' {
  interface Assertion<
    R extends void | Promise<void> = void,
    T = unknown,
  > extends TestingLibraryMatchers<T, R> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, void> {}
}

expect.extend(jestDom)

// A React tree or an Angular host application left rendered would keep every definition mounted
// inside it, and their registrations, into the next test. This runs before the `onTestFinished`
// hooks, so each page runtime is disposed only after everything mounted with it is gone.
afterEach(async () => {
  cleanupReactTrees()
  await cleanupAngularHosts()
})
