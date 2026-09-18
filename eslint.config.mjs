// @ts-check
/**
 * Workspace lint configuration.
 *
 * Which preset a directory gets is a statement about what that code *is*, not
 * about where it sits. The shell is the host: it legitimately imports the
 * loader, the registry and the federation runtime, and it reads browser storage
 * to pick up developer overrides before any store exists. An MFE does none of
 * those things, which is exactly what the author preset is there to prevent.
 * Scoping the shell as an author would turn three correct rules into three
 * false positives.
 */
import mfe from '@company/eslint-plugin-mfe'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/routeTree.gen.ts',
      '**/src/generated/**',
      '**/.mfe/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },

  ...mfe.framework({
    tsconfigRootDir: import.meta.dirname,
    files: ['packages/*/src/**/*.{ts,tsx}', 'tools/*/src/**/*.ts', 'apps/shell/src/**/*.{ts,tsx}'],
    // The storage adapter owns every read and write the framework makes, and
    // the shell's override bootstrap has to read localStorage before a store
    // exists to read it through. Both are named explicitly rather than inferred.
    storageAllowedScopes: [
      'packages/mfe-host/src/storage/**',
      'packages/mfe-host/src/overrides/**',
      'apps/shell/src/shell/override-storage.ts',
    ],
  }),

  ...mfe.author({
    tsconfigRootDir: import.meta.dirname,
    files: ['examples/*/src/**/*.{ts,tsx}'],
    // Widget ownership is declared, never guessed from a filename.
    widgetScopes: ['examples/alert-panel/src/**'],
  }),

  {
    name: 'repo/scaffold-cli',
    files: ['packages/create-mfe/src/**/*.ts'],
    rules: {
      // For a scaffolding CLI, stdout is the interface rather than a debug
      // leftover: the connection instructions it prints are the whole point of
      // the command. Framework runtime packages keep the ban.
      'no-console': 'off',
    },
  },
]
