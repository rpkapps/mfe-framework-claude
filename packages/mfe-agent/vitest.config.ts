import { defineConfig } from 'vitest/config'

/**
 * The same project the repository's root config runs, so this package's suite behaves identically
 * from inside it. `useChat` renders, so the suite needs a document.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
