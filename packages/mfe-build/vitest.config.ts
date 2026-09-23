import { defineConfig } from 'vitest/config'

/**
 * The same project the repository's root config runs, so this package's suite behaves identically
 * from inside it. Everything here runs at build time, in Node, against real files on disk.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
