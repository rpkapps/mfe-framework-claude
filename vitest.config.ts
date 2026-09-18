import { defineConfig } from 'vitest/config'

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
        },
        // Each example also carries these in its own vitest config, for running
        // one example's suite from inside it. Repeated here because this
        // project collects all three from the repository root, where an
        // example's own config is not read (§14).
        resolve: {
          alias: {
            '#mfe/config': '@company/mfe-react/testing/mfe-config',
            '#mfe/fetch': '@company/mfe-react/testing/mfe-fetch',
          },
        },
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
