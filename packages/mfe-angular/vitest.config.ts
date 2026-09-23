import { defineConfig } from 'vitest/config'

/**
 * The same project the repository's root config runs, so this package's suite behaves identically
 * from inside it. Without a config here `vitest run` falls back to the node environment, where
 * nothing Angular renders has a document to render into.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
})
