import { basename, resolve } from 'node:path'

import { defineConfig, type TestProjectInlineConfiguration } from 'vitest/config'
import { userContextDeclarationsForTests } from './tools/user-context/vitest.mjs'

import { tectonResolveForTests, tectonServerForTests } from './tools/tecton/vitest.mjs'
import { sourceResolveForTests, sourceSsrForTests } from './tools/workspace/conditions.mjs'

/**
 * `#mfe/meta` is generated per container, so it resolves to the real generated module of
 * whichever example imported it — a plugin rather than an alias, because an alias cannot depend
 * on the importer.
 */
const mfeMeta = {
  name: 'mfe-meta-per-example',
  enforce: 'pre' as const,
  resolveId(source: string, importer: string | undefined) {
    if (
      (source !== '#mfe/meta' && !/^#mfe\/user-context(?:\/[a-z0-9-]+)?$/.test(source)) ||
      importer === undefined
    )
      return null
    const match = /^(.*[/\\]examples[/\\][^/\\]+)[/\\]/.exec(importer)
    if (match?.[1] === undefined) return null
    if (source === '#mfe/meta') return resolve(match[1], '.mfe/meta.ts')
    const definition = source.split('/')[2] ?? basename(match[1])
    return resolve(match[1], `.mfe/user-context/${definition}.ts`)
  },
}

/**
 * Every project resolves the framework packages to their TypeScript source rather than their
 * dist/, so the suites run against the code as it is now without a build (tools/workspace).
 */
function withWorkspaceSource(
  project: TestProjectInlineConfiguration,
): TestProjectInlineConfiguration {
  return {
    ...project,
    resolve: { ...sourceResolveForTests, ...project.resolve },
    ssr: sourceSsrForTests,
  }
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'docs',
          root: './apps/docs',
          environment: 'jsdom',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          server: tectonServerForTests,
        },
        resolve: tectonResolveForTests,
      },
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
          name: 'angular',
          root: './packages/mfe-angular',
          environment: 'jsdom',
          include: ['src/**/*.test.ts'],
          setupFiles: ['./vitest.setup.ts'],
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
          name: 'agent',
          root: './packages/mfe-agent',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'agent-dev',
          root: './tools/agent-dev',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
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
          name: 'mfe-nx',
          root: './packages/mfe-nx',
          environment: 'node',
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
        plugins: [mfeMeta, userContextDeclarationsForTests],
      },
      {
        test: {
          name: 'shell',
          root: './apps/shell',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          // The chat's Markdown is rendered with Tecton parts, which must share the shell's React.
          server: tectonServerForTests,
        },
        resolve: tectonResolveForTests,
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
    ].map(withWorkspaceSource),
  },
})
