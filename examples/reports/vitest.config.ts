import { defineConfig } from 'vitest/config'

/**
 * The repository's root config runs all three examples as one project. This is
 * that project's setup, per example, so a single example's suite also runs from
 * inside the example — which is what an MFE's own repository would have.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['../../packages/mfe-react/vitest.setup.ts'],
    // An example that ships no test of its own yet is not a failure of this
    // command. The root suite is what gates the examples, and it collects all
    // three together.
    passWithNoTests: true,
  },
})
