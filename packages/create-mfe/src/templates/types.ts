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

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

const SCRIPTS: Record<string, string> = {
  dev: 'rspack serve',
  build: 'rspack build',
  generate: 'mfe generate',
  typecheck: 'tsc --noEmit',
  test: 'vitest run',
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
  '@rspack/cli': 'catalog:',
  '@rspack/core': 'catalog:',
  '@testing-library/jest-dom': 'catalog:',
  '@testing-library/react': 'catalog:',
  '@types/react': 'catalog:',
  '@types/react-dom': 'catalog:',
  eslint: 'catalog:',
  prettier: 'catalog:',
  typescript: 'catalog:',
  vitest: 'catalog:',
}

/** Sorted so a starter's extra entries land where a human would put them. */
function merge(base: Record<string, string>, extra: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries({ ...base, ...extra }).sort(([a], [b]) => (a < b ? -1 : 1)))
}

export function packageJsonFile(
  options: TemplateOptions,
  port: number,
  extra: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {},
): TemplateFile {
  return {
    path: 'package.json',
    contents: json({
      name: options.packageName,
      version: '0.1.0',
      private: true,
      type: 'module',
      mfe: { port, definitions: [options.id] },
      scripts: SCRIPTS,
      dependencies: merge(DEPENDENCIES, extra.dependencies ?? {}),
      devDependencies: merge(DEV_DEPENDENCIES, extra.devDependencies ?? {}),
    }),
  }
}

/** The files every generated project gets, identical in both starters. */
export function sharedFiles(): readonly TemplateFile[] {
  return [
    {
      path: '.gitignore',
      contents: `node_modules/
dist/

# Generated build output. Generation runs before typecheck, test and build.
routeTree.gen.ts
.mfe/

# Local developer values, never deployed values.
runtime-config.local.json
.env
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
      path: 'eslint.config.mjs',
      contents: `import mfe from '@company/eslint-plugin-mfe'

export default [
  { ignores: ['dist/**', '.mfe/**', '**/routeTree.gen.ts'] },
  ...mfe.author({
    tsconfigRootDir: import.meta.dirname,
    files: ['src/**/*.{ts,tsx}'],
  }),
]
`,
    },
    {
      path: 'runtime-config.example.json',
      contents: json({ apiBaseUrl: 'https://api.example.test/v1/' }),
    },
    {
      path: 'tsconfig.json',
      contents: json({
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          rootDir: '.',
          types: ['node', '@testing-library/jest-dom/vitest'],
          paths: {
            '#mfe/config': ['./.mfe/config.ts'],
            '#mfe/fetch': ['./.mfe/fetch.ts'],
            '#mfe/meta': ['./.mfe/meta.ts'],
          },
        },
        include: ['src/**/*', '.mfe/**/*', '*.config.ts'],
      }),
    },
    {
      path: 'rspack.config.ts',
      contents: `import { mfePlugin } from '@company/mfe-rspack'

// An ordinary Rspack configuration. mfePlugin is a normal plugin, not a
// wrapper, so every other option here stays exactly what it would otherwise be.
export default {
  entry: './src/main.ts',
  plugins: [mfePlugin()],
}
`,
    },
  ]
}

/** The shell override snippet, shared by both starter READMEs. */
export function overrideSnippet(id: string, port: number): string {
  return `\`\`\`js
const key = 'company:mfe:overrides'
const overrides = JSON.parse(localStorage.getItem(key) || '{}')
overrides['${id}'] = 'http://localhost:${port}/mf-manifest.json'
localStorage.setItem(key, JSON.stringify(overrides))
location.reload()
\`\`\`

Deleting just your id and reloading resets it; unrelated overrides are kept. A
change needs a reload rather than a remount, because the container's modules are
already registered under the same name and its chunks are document-level. The
override is a URL only: it never carries tokens or configuration.`
}
