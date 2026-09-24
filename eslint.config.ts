/**
 * Which preset a directory gets is a statement about what that code *is*, not where it sits:
 * the shell is the host, so it legitimately imports the loader, the registry and the
 * federation runtime that the author preset exists to forbid.
 *
 * The file is TypeScript so that ESLint loads it, and the workspace plugin's own `.ts` sources
 * behind it, through jiti. As `.mjs` it reached the plugin's entry as an untransformed `.ts`
 * import that only a Node with type stripping could read, so an editor running ESLint on its own
 * bundled Node met a configuration error on every file instead of a lint result.
 */
import type { Linter } from 'eslint'

import mfe from '@company/eslint-plugin-mfe'
import react from '@company/eslint-plugin-mfe/react'

import fieldwork from './examples/fieldwork/eslint.config.ts'

/**
 * The Angular example: its own Nx workspace, linted by the configuration its generator wrote,
 * which `basePath` rebases onto the example's directory. The React and tooling presets below
 * stay off it, since that configuration already covers every file of it they would reach.
 */
const ANGULAR_EXAMPLE = 'examples/fieldwork'

function outsideAngularExample(configs: Linter.Config[]): Linter.Config[] {
  return configs.map(object => ({
    ...object,
    ignores: [...(object.ignores ?? []), `${ANGULAR_EXAMPLE}/**`],
  }))
}

/** The vendor telemetry ban `mfe.framework()` carries; restated where `mfe.application()` runs. */
const TELEMETRY_BAN = {
  group: ['@opentelemetry/*', '@grafana/faro', '@grafana/faro-*'],
  message:
    'Telemetry boundary: emit through the neutral telemetry contract in @company/mfe-core (`MfeTelemetry`) rather than a vendor SDK directly. Type-only imports are restricted too.',
  allowTypeImports: false,
} as const

const config: Linter.Config[] = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/routeTree.gen.ts',
      '**/src/generated/**',
      '**/.mfe/**',
      // The caches Nx and the Angular builder keep in the Angular example's Nx workspace.
      '**/.nx/**',
      '**/.angular/**',
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
      'packages/mfe-runtime/src/storage/**',
      'packages/mfe-runtime/src/overrides/**',
      'apps/shell/src/boot.tsx',
      // The other end of the same bootstrap: the override key and the panel's own flag are
      // the page's, not any definition's, and are read before a store exists to read them.
      'packages/mfe-devtools/src/browser-storage.ts',
      // The theme only: the legacy Angular applications read `localStorage["theme"]` as a bare
      // string, so its name and shape are fixed by code that is not ours (docs/decisions.md §24).
      'apps/shell/src/shell/preferences.ts',
      // The OIDC session and the sign-in request's state and PKCE verifier, in sessionStorage
      // under `shell.oidc.`, and the tab's own id under `shell.tab`: they must survive a reload
      // and the redirect to the identity provider, are read before any store exists, and die
      // with the tab (docs/decisions.md §36).
      'apps/shell/src/auth/gate.ts',
      // A further entry here is evidence of another missing primitive (docs/decisions.md §24).
    ],
  }),

  ...outsideAngularExample(
    react.author({
      tsconfigRootDir: import.meta.dirname,
      files: ['examples/*/src/**/*.{ts,tsx}'],
      // Widget ownership is declared, never guessed from a filename.
      widgetScopes: ['examples/alert-panel/src/**', 'examples/insights/src/**'],
    }),
  ),

  ...fieldwork.map(object => ({ ...object, basePath: ANGULAR_EXAMPLE })),

  /*
   * `application()` replaces `framework()`'s own `no-restricted-imports` rule for the files it
   * covers rather than adding to it (ESLint keeps the last config's value for a repeated rule), so
   * both application configs restate the vendor telemetry ban `framework()` would otherwise carry
   * for these files: the shell's own Faro adapter is the one place that names `@grafana/faro-*`
   * (`repo/shell-telemetry-adapter`, below), and a cross-adapter harness has no telemetry vendor
   * of its own to name either.
   */
  ...mfe.application({
    files: ['apps/shell/src/**/*.{ts,tsx}'],
    adapterModules: ['@company/mfe-react'],
    extraRestrictedPatterns: [TELEMETRY_BAN],
  }),

  ...mfe.application({
    files: ['tools/interop/src/**/*.ts'],
    // A cross-adapter harness, so it may import both adapters.
    adapterModules: ['@company/mfe-react', '@company/mfe-angular'],
    extraRestrictedPatterns: [TELEMETRY_BAN],
  }),

  ...outsideAngularExample(
    mfe.tooling({
      tsconfigRootDir: import.meta.dirname,
      files: [
        // The defaults, plus the two files this workspace names differently: fumadocs reads
        // `source.config.ts`, and the `.d.mts` files are the types of the plain-JavaScript
        // helpers beside them.
        ...mfe.DEFAULT_TOOLING_FILES,
        'apps/docs/source.config.ts',
        'tools/tecton/*.d.mts',
      ],
    }),
  ),

  /*
   * The design system's `strict` preset used to run over the shell and the examples. Tecton
   * removed `@tecton/eslint-config`, so there is no preset left to compose and the block that
   * did it is gone; nothing in this workspace checks a Tailwind class against the token set.
   */

  {
    // The one file that adapts the neutral telemetry contract to Faro.
    name: 'repo/shell-telemetry-adapter',
    files: ['apps/shell/src/shell/faro.ts', 'apps/shell/src/shell/faro.test.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },

  {
    // Registers remotes at boot: the one file that legitimately imports the Module Federation
    // runtime directly, as the header comment atop this config says the shell may.
    name: 'repo/shell-boot-federation',
    files: ['apps/shell/src/boot.tsx'],
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

export default config
