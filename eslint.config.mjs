// @ts-check
/**
 * Which preset a directory gets is a statement about what that code *is*, not where it sits:
 * the shell is the host, so it legitimately imports the loader, the registry and the
 * federation runtime that the author preset exists to forbid.
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
    files: [
      'packages/*/src/**/*.{ts,tsx}',
      'tools/*/src/**/*.ts',
      'apps/shell/src/**/*.{ts,tsx}',
      // The documentation site is not an MFE, but it is first-party React in this workspace and
      // the framework preset is the one that holds first-party code to the repository's rules.
      'apps/docs/src/**/*.{ts,tsx}',
    ],
    // `rules-of-hooks` reads any call to something named `use` as a hook call, so a bundler
    // plugin building a module rule's `use:` list is told it called a Hook outside a component.
    reactFiles: [
      'packages/mfe-react/src/**/*.{ts,tsx}',
      'packages/mfe-devtools/src/**/*.{ts,tsx}',
      'apps/shell/src/**/*.{ts,tsx}',
      'apps/docs/src/**/*.{ts,tsx}',
    ],
    // The storage adapter owns every read and write the framework makes, and the shell's
    // override bootstrap has to read localStorage before a store exists to read it through.
    storageAllowedScopes: [
      'packages/mfe-host/src/storage/**',
      'packages/mfe-host/src/overrides/**',
      'apps/shell/src/boot.tsx',
      // The other end of the same bootstrap: the override key and the panel's own flag are
      // the page's, not any definition's, and are read before a store exists to read them.
      'packages/mfe-devtools/src/browser-storage.ts',
      // The theme only: the legacy Angular applications read `localStorage["theme"]` as a bare
      // string, so its name and shape are fixed by code that is not ours (docs/decisions.md §24).
      'apps/shell/src/shell/preferences.ts',
      // A further entry here is evidence of another missing primitive (docs/decisions.md §24).
    ],
  }),

  ...mfe.author({
    tsconfigRootDir: import.meta.dirname,
    files: ['examples/*/src/**/*.{ts,tsx}'],
    // Widget ownership is declared, never guessed from a filename.
    widgetScopes: ['examples/alert-panel/src/**'],
  }),

  /*
   * The design system's `strict` preset is off: its `ui` alias cannot resolve in a workspace
   * consuming Tecton through subpath exports, so its token rules flag every bracketed utility,
   * grid templates included. Re-enable it by giving `components.json` an `aliases.ui` this
   * workspace resolves, then restoring the block below.
   */
  // ...tecton.configs.strict.map(config => ({
  //   ...config,
  //   files: ['apps/shell/src/**/*.{ts,tsx}', 'examples/*/src/**/*.{ts,tsx}'],
  // })),

  {
    // The one file that adapts the neutral telemetry contract to Faro.
    name: 'repo/shell-telemetry-adapter',
    files: ['apps/shell/src/shell/faro.ts', 'apps/shell/src/shell/faro.test.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },

  {
    /*
     * TanStack Router signals a missing page by throwing the object `notFound()` returns, which is
     * a control-flow marker rather than an `Error`; the router catches it and renders the not-found
     * component. `only-throw-error` reads it as a thrown non-error, so it is off for the route
     * files of the documentation site and nowhere else.
     */
    name: 'repo/docs-router-signals',
    files: ['apps/docs/src/routes/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/only-throw-error': 'off' },
  },

  {
    name: 'repo/scaffold-cli',
    files: ['packages/create-mfe/src/**/*.ts'],
    rules: {
      // For a scaffolding CLI stdout is the interface rather than a debug leftover.
      'no-console': 'off',
    },
  },

  {
    name: 'repo/generate-cli',
    files: ['packages/mfe-rspack/src/cli/**/*.ts'],
    rules: {
      // Same as the scaffold; only the CLI directory is exempt, so the generators keep the ban.
      'no-console': 'off',
    },
  },
]
