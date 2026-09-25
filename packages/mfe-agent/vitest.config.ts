import { defineConfig } from 'vitest/config'

/**
 * The same project the repository's root config runs, so this package's suite behaves identically
 * from inside it. Nothing here renders, so the suite runs in Node, which has `fetch` and streams.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
