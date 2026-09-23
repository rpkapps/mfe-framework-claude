import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

import { tectonResolveForTests, tectonServerForTests } from './tools/tecton/vitest.mjs'

/**
 * `#mfe/meta` is generated per container, so it resolves to the real generated module of
 * whichever example imported it — a plugin rather than an alias, because an alias cannot depend
 * on the importer.
 */
const mfeMeta = {
  name: 'mfe-meta-per-example',
  enforce: 'pre' as const,
  resolveId(source: string, importer: string | undefined) {
    if (source !== '#mfe/meta' || importer === undefined) return null
    const match = /^(.*[/\\]examples[/\\][^/\\]+)[/\\]/.exec(importer)
    return match?.[1] === undefined ? null : resolve(match[1], '.mfe/meta.ts')
  },
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          root: './packages/mfe-core',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'runtime',
          root: './packages/mfe-runtime',
          environment: 'jsdom',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'react',
          root: './packages/mfe-react',
          environment: 'jsdom',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.ts'],
          server: tectonServerForTests,
        },
        resolve: tectonResolveForTests,
      },
      {
        test: {
          name: 'devtools',
          root: './packages/mfe-devtools',
          environment: 'jsdom',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          setupFiles: ['../mfe-react/vitest.setup.ts'],
          server: tectonServerForTests,
        },
        resolve: tectonResolveForTests,
      },
      {
        test: {
          name: 'rspack',
          root: './packages/mfe-rspack',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'build',
          root: './packages/mfe-build',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'legacy-angular',
          root: './packages/mfe-legacy-angular',
          environment: 'jsdom',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'eslint-plugin',
          root: './packages/eslint-plugin-mfe',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'create-mfe',
          root: './packages/create-mfe',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'examples',
          root: './examples',
          environment: 'jsdom',
          include: ['*/src/**/*.test.ts', '*/src/**/*.test.tsx'],
          setupFiles: ['../packages/mfe-react/vitest.setup.ts'],
          server: tectonServerForTests,
        },
        // Repeated from each example's own vitest config, because this project collects every
        // example from the repository root, where an example's own config is not read (§14).
        resolve: {
          ...tectonResolveForTests,
          alias: [
            // `#mfe/config` and `#mfe/fetch` are replaced by test fixtures, while the source
            // under test keeps its production imports (§14).
            { find: /^#mfe\/config$/, replacement: '@company/mfe-react/testing/mfe-config' },
            { find: /^#mfe\/fetch$/, replacement: '@company/mfe-react/testing/mfe-fetch' },
            ...tectonResolveForTests.alias,
          ],
        },
        plugins: [mfeMeta],
      },
      {
        test: {
          name: 'shell',
          root: './apps/shell',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'interop',
          root: './tools/interop',
          environment: 'jsdom',
          include: ['src/**/*.test.ts'],
          setupFiles: ['./vitest.setup.ts'],
          globalSetup: ['./src/__tests__/build-container-b.ts'],
        },
      },
    ],
  },
})
