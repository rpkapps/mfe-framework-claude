/** One file a template emits. */
export interface TemplateFile {
  /** Path relative to the generated project root. */
  readonly path: string
  readonly contents: string
}

export interface TemplateOptions {
  readonly id: string
  readonly packageName: string
}

/**
 * Shared files both starters emit.
 *
 * Neither starter adds configuration decisions to the quickstart: the formatter,
 * the lint preset and the TypeScript baseline are set up, not offered.
 */
export function sharedFiles(): readonly TemplateFile[] {
  return [
    {
      path: '.gitignore',
      contents: [
        'node_modules/',
        'dist/',
        '',
        '# Generated build output. Generation runs before typecheck, test and build.',
        'routeTree.gen.ts',
        '.mfe/',
        '',
        '# Local developer values, never deployed values.',
        'runtime-config.local.json',
        '.env',
        '',
      ].join('\n'),
    },
    {
      path: '.prettierrc.json',
      contents:
        JSON.stringify(
          {
            semi: false,
            singleQuote: true,
            trailingComma: 'all',
            printWidth: 100,
            arrowParens: 'avoid',
          },
          null,
          2,
        ) + '\n',
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
      contents: JSON.stringify({ apiBaseUrl: 'https://api.example.test/v1/' }, null, 2) + '\n',
    },
  ]
}

/** The scripts every generated project provides. */
export function scripts(): Record<string, string> {
  return {
    dev: 'rspack serve',
    build: 'rspack build',
    generate: 'mfe generate',
    typecheck: 'tsc --noEmit',
    test: 'vitest run',
    lint: 'eslint .',
    format: 'prettier --write .',
    'format:check': 'prettier --check .',
  }
}
