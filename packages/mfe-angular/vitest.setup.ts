/**
 * The adapter's tests compile components just in time, so the compiler has to be loaded before the
 * first one is created. No zone setup: every mount is zoneless.
 */

import '@angular/compiler'

import { afterEach } from 'vitest'

import { cleanup, resetGeneratedAliases } from './src/testing/index.ts'

// A mount a test forgot to dispose would otherwise keep its application, its subscriptions and
// its registrations into the next test; the generated-alias fixtures are module state too.
afterEach(async () => {
  await cleanup()
  resetGeneratedAliases()
})
