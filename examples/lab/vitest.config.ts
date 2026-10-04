import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

import { tectonResolveForTests, tectonServerForTests } from '../../tools/tecton/vitest.mjs'

/**
 * The repository's root config runs every example as one project. This is that
 * project's setup, per example, so a single example's suite also runs from
 * inside the example — which is what an MFE's own repository would have.
 */
export default defineConfig({
  resolve: {
    ...tectonResolveForTests,
    alias: [
      // The generated modules, as a test sees them (§14). `#mfe/config` and
      // `#mfe/fetch` are replaced by fixtures: the real ones fetch
      // runtime-config.json in a top-level await and build a transport from
      // the shell's session, neither of which exists in a component test. The
      // source under test keeps its production imports, and tsconfig still
      // maps these to the real generated modules, so the types stay exact.
      { find: /^#mfe\/config$/, replacement: '@company/mfe-react/testing/mfe-config' },
      { find: /^#mfe\/fetch$/, replacement: '@company/mfe-react/testing/mfe-fetch' },
      // `#mfe/meta` is plain generated data with no side effects, so a test
      // reads the real thing.
      {
        find: /^#mfe\/meta$/,
        replacement: fileURLToPath(new URL('./.mfe/meta.ts', import.meta.url)),
      },
      // One copy of React, and of everything that carries React context: the
      // design system is a link to a checkout with its own node_modules.
      ...tectonResolveForTests.alias,
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['../../packages/mfe-react/vitest.setup.ts'],
    server: tectonServerForTests,
  },
})
