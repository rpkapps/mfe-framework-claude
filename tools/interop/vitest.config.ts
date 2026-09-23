import { defineConfig } from 'vitest/config'

/**
 * The same project the repository's root config runs, so `pnpm --filter @company/interop-tests
 * test` behaves identically from inside the package: both adapters render, so both need a document.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Bundles the fixture container on a second React for the two-React-versions test.
    globalSetup: ['./src/__tests__/build-container-b.ts'],
  },
})
