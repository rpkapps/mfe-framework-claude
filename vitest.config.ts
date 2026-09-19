import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

import { tectonResolveForTests, tectonServerForTests } from './tools/tecton/vitest.mjs'

/**
 * `#mfe/meta` is generated per container, so unlike `#mfe/config` and
 * `#mfe/fetch` it cannot be aliased to one fixture: it resolves to the real
 * generated module of whichever example imported it. A plugin rather than an
 * alias, because an alias cannot depend on the importer.
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
          name: 'host',
          root: './packages/mfe-host',
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
          name: 'rspack',
          root: './packages/mfe-rspack',
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
        // Each example also carries these in its own vitest config, for running
        // one example's suite from inside it. Repeated here because this
        // project collects every example from the repository root, where an
        // example's own config is not read (§14).
        resolve: {
          ...tectonResolveForTests,
          alias: [
            // The generated modules, as a test sees them (§14). `#mfe/config`
            // and `#mfe/fetch` are replaced by fixtures; the source under test
            // keeps its production imports.
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
    ],
  },
})
