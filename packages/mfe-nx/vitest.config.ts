import { defineConfig } from 'vitest/config'

/**
 * The same project the repository's root config runs, so this package's suite behaves
 * identically from inside it. Node, not jsdom: generators only touch an in-memory `Tree`, never a
 * DOM.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
