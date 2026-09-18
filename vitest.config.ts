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
          name: 'browser-matrix',
          root: './tools/browser-matrix',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
  },
})
