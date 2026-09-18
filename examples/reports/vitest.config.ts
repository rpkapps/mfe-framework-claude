import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * The repository's root config runs all three examples as one project. This is
 * that project's setup, per example, so a single example's suite also runs from
 * inside the example — which is what an MFE's own repository would have.
 */
export default defineConfig({
  resolve: {
    alias: {
      // The generated modules, as a test sees them (§14). `#mfe/config` and
      // `#mfe/fetch` are replaced by fixtures: the real ones fetch
      // runtime-config.json in a top-level await and build a transport from
      // the shell's session, neither of which exists in a component test. The
      // source under test keeps its production imports, and tsconfig still
      // maps these to the real generated modules, so the types stay exact.
      '#mfe/config': '@company/mfe-react/testing/mfe-config',
      '#mfe/fetch': '@company/mfe-react/testing/mfe-fetch',
      // `#mfe/meta` is plain generated data with no side effects, so a test
      // reads the real thing.
      '#mfe/meta': fileURLToPath(new URL('./.mfe/meta.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['../../packages/mfe-react/vitest.setup.ts'],
  },
})
