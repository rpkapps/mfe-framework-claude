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
  },
})
