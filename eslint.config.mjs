// @ts-check
/**
 * Workspace lint configuration.
 *
 * The framework preset carries the package-boundary restrictions, async and
 * type-safety rules, React correctness and the compiler diagnostics. Scoping is
 * explicit rather than inferred from filenames: the Widget-owned rule only
 * applies to directories that are actually Widget source.
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
    files: ['packages/*/src/**/*.{ts,tsx}', 'tools/*/src/**/*.ts'],
    // The storage adapter is the one place that may touch browser storage
    // directly, and the shell reads developer overrides before any store exists.
    storageAllowedScopes: [
      'packages/mfe-host/src/storage/**',
      'packages/mfe-host/src/overrides/**',
    ],
  }),

  ...mfe.author({
    tsconfigRootDir: import.meta.dirname,
    files: ['examples/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
    widgetScopes: ['examples/alert-panel/src/**'],
  }),
]
