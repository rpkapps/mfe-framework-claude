// JIT component creation needs the compiler present before any component is created. No zone.js
// setup here: this container runs zoneless.
import '@angular/compiler'

import { cleanup, resetGeneratedAliases } from '@company/mfe-angular/testing'
import { afterEach } from 'vitest'

// jsdom has no matchMedia, and PrimeNG's overlay behind p-select reads it as soon as it renders.
if (!('matchMedia' in window)) {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) satisfies MediaQueryList,
  })
}

// Every mount a test forgot to dispose, and every value a test gave #mfe/config or #mfe/fetch.
afterEach(async () => {
  await cleanup()
  resetGeneratedAliases()
})
