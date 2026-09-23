/**
 * The files both starters share, and the builders for the two that differ only
 * in their dependency list. Neither starter offers configuration decisions: the
 * formatter, the lint preset and the TypeScript baseline are set up, not asked.
 */

/** One file a template emits. Path is relative to the generated project root. */
export interface TemplateFile {
  readonly path: string
  readonly contents: string
}

export interface TemplateOptions {
  readonly id: string
  readonly packageName: string
}

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * Listed as its own script because an editor on a fresh clone needs the
 * generated #mfe/* modules and route tree before anything else can run.
 */
const SCRIPTS: Record<string, string> = {
  dev: 'pnpm run generate && rsbuild dev',
  build: 'pnpm run generate && rsbuild build',
  generate: 'mfe-generate',
  typecheck: 'pnpm run generate && tsc --noEmit',
  test: 'pnpm run generate && vitest run',
  lint: 'eslint .',
  format: 'prettier --write .',
  'format:check': 'prettier --check .',
}

const DEPENDENCIES: Record<string, string> = {
  '@company/mfe-react': 'workspace:*',
  react: 'catalog:',
  'react-dom': 'catalog:',
  zod: 'catalog:',
}

const DEV_DEPENDENCIES: Record<string, string> = {
  '@company/eslint-plugin-mfe': 'workspace:*',
  '@company/mfe-rspack': 'workspace:*',
  '@rsbuild/core': 'catalog:',
  '@rsbuild/plugin-react': 'catalog:',
  '@tanstack/eslint-plugin-query': 'catalog:',
  '@tanstack/eslint-plugin-router': 'catalog:',
  '@testing-library/jest-dom': 'catalog:',
  '@testing-library/react': 'catalog:',
  '@types/react': 'catalog:',
  '@types/react-dom': 'catalog:',
  eslint: 'catalog:',
  'eslint-plugin-react-hooks': 'catalog:',
  prettier: 'catalog:',
  // The container compiles its own stylesheet: the build generates the entry
  // and adds the PostCSS plugin, and this is the Tailwind that entry imports.
  tailwindcss: 'catalog:',
  typescript: 'catalog:',
  vitest: 'catalog:',
}

/** Sorted so a starter's extra entries land where a human would put them. */
function merge(
  base: Record<string, string>,
  extra: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...base, ...extra }).sort(([a], [b]) => (a < b ? -1 : 1)),
  )
}

export function packageJsonFile(
  options: TemplateOptions,
  port: number,
  extra: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    exports?: Record<string, string>
  } = {},
): TemplateFile {
  return {
    path: 'package.json',
    contents: json({
      name: options.packageName,
      version: '0.1.0',
      private: true,
      type: 'module',
      mfe: { port, definitions: [options.id] },
      ...(extra.exports === undefined ? {} : { exports: extra.exports }),
      scripts: SCRIPTS,
      dependencies: merge(DEPENDENCIES, extra.dependencies ?? {}),
      devDependencies: merge(DEV_DEPENDENCIES, extra.devDependencies ?? {}),
    }),
  }
}

/**
 * The files every generated project gets. `entry` is the starter's definitions
 * module, which is `src/mfe.tsx` when the entry itself contains JSX.
 */
export function sharedFiles(entry: string): readonly TemplateFile[] {
  return [
    {
      path: '.gitignore',
      contents: `node_modules/
dist/

# Generated build output. Generation runs before typecheck, test and build.
routeTree.gen.ts
.mfe/
`,
    },
    {
      path: 'vitest.config.ts',
      contents: `import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // The generated modules, as a test sees them. The real #mfe/config
      // fetches runtime-config.json in a top-level await and the real
      // #mfe/fetch builds a transport from the shell's session, so neither
      // works in a component test. Your source keeps its production imports
      // and the test supplies the values:
      //
      //   import { setMfeConfig, setMfeApiBaseUrl, setMfeFetch } from '@company/mfe-react/testing'
      //
      // tsconfig still maps these to the real generated modules, so a field
      // you never declared is still a type error.
      '#mfe/config': '@company/mfe-react/testing/mfe-config',
      '#mfe/fetch': '@company/mfe-react/testing/mfe-fetch',
      // Plain generated data with no side effects, so a test reads the real one.
      '#mfe/meta': fileURLToPath(new URL('./.mfe/meta.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
})
`,
    },
    {
      path: 'vitest.setup.ts',
      contents: `/**
 * Installs jest-dom's matchers, and declares them, from this project's own
 * vitest instance. Both halves live here so they cannot drift: the shipped
 * \`@testing-library/jest-dom/vitest\` entry gets each one wrong in its own way.
 *
 * Runtime: that entry is CJS and calls \`require('vitest').expect.extend(...)\`,
 * which can resolve a second vitest instance. When it does, the \`rejects\` chain
 * lands on the other one and \`await expect(p).rejects.toThrow(/…/)\` fails with
 * an empty message for every rejection, including a plain Error.
 *
 * Types: that entry augments \`interface Assertion<T = any>\`, which was jest's
 * shape. Vitest declares two type parameters, and declaration merging needs
 * them to match exactly, so the augmentation is dropped in silence and every
 * matcher call is a type error at its own call site. The declaration below
 * matches — \`R\` is the return type, \`T\` the asserted value — so it merges.
 * Listing the entry in a tsconfig \`types\` array does nothing for either half.
 */

import * as jestDom from '@testing-library/jest-dom/matchers'
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'
import { cleanup } from '@testing-library/react'
import { afterEach, expect } from 'vitest'

declare module 'vitest' {
  interface Assertion<
    R extends void | Promise<void> = void,
    T = unknown,
  > extends TestingLibraryMatchers<T, R> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, void> {}
}

expect.extend(jestDom)

// Nothing leaks from one test into the next.
afterEach(() => {
  cleanup()
})
`,
    },
    {
      path: '.prettierrc.json',
      contents: json({
        semi: false,
        singleQuote: true,
        trailingComma: 'all',
        printWidth: 100,
        arrowParens: 'avoid',
      }),
    },
    {
      // TypeScript, so ESLint loads it — and the plugin's own `.ts` sources behind
      // it — through jiti, on whatever Node an editor happens to bundle.
      path: 'eslint.config.ts',
      contents: `import mfe from '@company/eslint-plugin-mfe'
import react from '@company/eslint-plugin-mfe/react'

export default [
  { ignores: ['dist/**', '.mfe/**', '**/routeTree.gen.ts'] },
  ...react.author({
    tsconfigRootDir: import.meta.dirname,
    files: ['src/**/*.{ts,tsx}'],
  }),
  // This file, and the rsbuild, vitest and test-setup files beside it.
  ...mfe.tooling({ tsconfigRootDir: import.meta.dirname }),
]
`,
    },
    {
      path: 'tsconfig.json',
      // Written out rather than serialized: this file carries comments,
      // and Prettier formats JSON with comments differently from
      // JSON.stringify, which would fail the project's own format check.
      contents: `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "types": ["node"],
    "paths": {
      "#mfe/config": ["./.mfe/config.ts"],
      "#mfe/fetch": ["./.mfe/fetch.ts"],
      "#mfe/meta": ["./.mfe/meta.ts"]
    }
  },
  // vitest.setup.ts is in the program because it carries the matcher
  // declarations; outside it, every matcher call is a type error.
  "include": ["src/**/*", ".mfe/**/*", "vitest.setup.ts", "*.config.ts"]
}
`,
    },
    {
      path: 'rsbuild.config.ts',
      contents: `/**
 * An ordinary Rsbuild configuration. \`pluginMfe()\` is a normal plugin rather
 * than a wrapper, so everything here is what it would be in any React project.
 *
 * The plugin owns what makes this a container: definition discovery, the
 * generated \`#mfe/*\` modules and the stylesheet beside them, Module
 * Federation's name, exposes and sharing, the registry entry,
 * container-relative asset URLs, the PostCSS pipeline that compiles that
 * stylesheet and scopes it to this container's mount roots, and the React
 * Compiler transform. None of that is repeated here, and none of it is
 * configurable per project — a page only works when every container agrees.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pluginMfe } from '@company/mfe-rspack'
import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'

const here = dirname(fileURLToPath(import.meta.url))

/** The port is declared once, in the manifest \`pnpm dev\` reads it from too. */
const manifest = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as {
  readonly mfe: { readonly port: number }
}

export default defineConfig({
  // pluginReact supplies the automatic JSX runtime and Fast Refresh; pluginMfe
  // supplies everything that makes this project a container.
  plugins: [pluginReact(), pluginMfe()],

  source: { entry: { index: '${entry}' } },

  // A remote is fetched by a shell, never browsed to, so it needs no document.
  tools: { htmlPlugin: false },

  server: {
    port: manifest.mfe.port,
    // The shell serves the page from its own origin and reads this container's
    // manifest, remote entry and chunks from here.
    cors: true,
    // runtime-config.json carries a deployment's values, so it is never built
    // into the container. In development this server publishes the container's
    // own local copy next to its assets, which is where the generated loader
    // resolves it from.
    publicDir: { name: 'public' },
  },

  dev: {
    // Compiles a chunk the first time the page asks for it, over an endpoint on
    // this server's own origin. A container is loaded by a shell on a different
    // origin, so that request never arrives: the route renders nothing and
    // reports nothing.
    lazyCompilation: false,
  },
})
`,
    },
  ]
}

/**
 * The "connect to the shell" section, shared by both starter READMEs. There is
 * no standalone harness: an MFE is developed against the real shell with a real
 * session, so no class of authentication bug waits until deployment.
 */
export function overrideSection(id: string, port: number): string {
  return `## Connecting to the shell

Start the shell, run this in its browser console, and reload.

\`\`\`js
const key = 'company:mfe:overrides'
const overrides = JSON.parse(localStorage.getItem(key) || '{}')
overrides['${id}'] = 'http://localhost:${port}/mf-manifest.json'
localStorage.setItem(key, JSON.stringify(overrides))
location.reload()
\`\`\`

Deleting just your id resets it; unrelated overrides are kept. A change needs a
reload, not a remount: the container's modules are already registered and its
chunks are document-level. The override is a URL only, never a token.`
}
