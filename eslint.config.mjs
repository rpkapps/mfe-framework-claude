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
    // React rules apply only where React is. `rules-of-hooks` treats a call to
    // anything named `use` as a hook call, so a bundler plugin building a module
    // rule's `use:` loader list gets told it is calling a Hook outside a
    // component. Narrowing is the repair; suppressing at each site is not.
    reactFiles: [
      'packages/mfe-react/src/**/*.{ts,tsx}',
      'packages/mfe-devtools/src/**/*.{ts,tsx}',
      'apps/shell/src/**/*.{ts,tsx}',
    ],
    // The storage adapter owns every read and write the framework makes, and
    // the shell's override bootstrap has to read localStorage before a store
    // exists to read it through. Both are named explicitly rather than inferred.
    storageAllowedScopes: [
      'packages/mfe-host/src/storage/**',
      'packages/mfe-host/src/overrides/**',
      'apps/shell/src/boot.tsx',
      // The other end of the same bootstrap. The devtools panel writes the
      // override key and reads its own flag, and neither belongs to a
      // definition: both are the page's, read before a store exists to read
      // them through. One accessor, named explicitly rather than inferred.
      'packages/mfe-devtools/src/browser-storage.ts',
      // The theme belongs to the page rather than to any definition on it, and
      // it has to outlive a sign-out — which is exactly what mount-scoped
      // storage retires. Named explicitly, never inferred.
      'apps/shell/src/shell/preferences.ts',
      // The session generation is the fence mount-scoped storage is checked
      // against, established at boot before any mount exists to store it
      // through. It cannot be written through the thing it gates.
      'apps/shell/src/shell/session-generation.ts',
      // The dashboard the developer composed belongs to the shell, not to any
      // definition on it, so it cannot go through the mount-scoped storage the
      // rule exists to enforce. Named explicitly, never inferred.
      'apps/shell/src/shell/dashboard/layout-store.ts',
    ],
  }),

  ...mfe.author({
    tsconfigRootDir: import.meta.dirname,
    files: ['examples/*/src/**/*.{ts,tsx}'],
    // Widget ownership is declared, never guessed from a filename.
    widgetScopes: ['examples/alert-panel/src/**'],
  }),

  /*
   * The design system's own guardrails are switched off.
   *
   * They were here for the failures that are otherwise silent: Tecton resets
   * Tailwind's stock palette, so `bg-red-500` generates no CSS at all — it type
   * checks, it renders unstyled, and nothing reports it. The `strict` preset is
   * meant to read the project's real Tailwind theme through `components.json`
   * and name the nearest Tecton token instead.
   *
   * It cannot read it here. Every run opens with the preset reporting its own
   * misconfiguration — the `ui` alias does not resolve to a directory in a
   * workspace that consumes Tecton through `@tecton/react/*` subpath exports
   * rather than a copied `components/ui` folder — and with that resolution gone
   * the token rules fall back to flagging any bracketed utility, including the
   * grid templates a responsive layout is made of. A guardrail that cannot tell
   * an off-token colour from a correct `minmax()` is noise, and noise is what
   * gets a whole preset disabled rather than one rule.
   *
   * Re-enable it by giving `components.json` an `aliases.ui` this workspace
   * actually resolves, then restoring the block below.
   */
  // ...tecton.configs.strict.map(config => ({
  //   ...config,
  //   files: ['apps/shell/src/**/*.{ts,tsx}', 'examples/*/src/**/*.{ts,tsx}'],
  // })),

  {
    // The telemetry ban exists so no framework package pins a vendor SDK version
    // for the whole page. Its own message says the shell adapts the neutral
    // contract to Faro, so the file that does exactly that is where the ban
    // stops applying. Named explicitly, never inferred from a directory.
    name: 'repo/shell-telemetry-adapter',
    files: ['apps/shell/src/shell/faro.ts', 'apps/shell/src/shell/faro.test.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },

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

  {
    name: 'repo/generate-cli',
    files: ['packages/mfe-rspack/src/cli/**/*.ts'],
    rules: {
      // Same reason as the scaffold: a command reports what it generated and
      // which diagnostic to open on its own streams. Only the CLI directory is
      // exempt, so the plugin and the generators around it keep the ban.
      'no-console': 'off',
    },
  },
]
