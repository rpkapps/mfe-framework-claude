import { defineConfig } from 'vitest/config'

/**
 * The same project the repository's root config runs, so this package's suite
 * behaves identically from inside it. Without a config here `vitest run` falls
 * back to the node environment, where anything touching the DOM fails.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
