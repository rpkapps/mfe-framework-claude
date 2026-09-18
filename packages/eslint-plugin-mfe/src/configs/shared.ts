/**
 * The pieces both presets are built from.
 *
 * The presets are plain flat-config arrays, so a consumer can spread them,
 * reorder them and override any single rule afterwards. Nothing here hides
 * behind an opaque "extends".
 */

import type { ESLint, Linter } from 'eslint'
import { builtinRules } from 'eslint/use-at-your-own-risk'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import { rules as mfeRules } from '../rules/index.ts'

export const TS_FILES: readonly string[] = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']

export const ALL_FILES: readonly string[] = [
  ...TS_FILES,
  '**/*.js',
  '**/*.jsx',
  '**/*.mjs',
  '**/*.cjs',
]

/**
 * `Linter.Config` and the "compatible" config types that typescript-eslint and
 * the React and TanStack plugins publish describe the same objects with
 * different precision: those plugins type loosely on purpose so they work across
 * ESLint majors. This assertion is the whole of that impedance mismatch, kept in
 * one place instead of scattered through the presets.
 */
export function asConfigs(value: unknown): Linter.Config[] {
  return value as Linter.Config[]
}

/** The same mismatch, for the parser object typescript-eslint publishes. */
export function asParser(value: unknown): Linter.Parser {
  return value as Linter.Parser
}

/** Copies a config array, scoping every entry to `files` and naming each one. */
export function withFiles(
  configs: readonly Linter.Config[],
  files: readonly string[],
  namePrefix: string,
): Linter.Config[] {
  return configs.map((config, index) => ({
    ...config,
    name: `${namePrefix}-${String(index)}`,
    files: [...files],
  }))
}

/**
 * ESLint's recommended baseline.
 *
 * `@eslint/js` is not a dependency of this package, and adding one only to read
 * a rule list would pin a second copy of ESLint's metadata. The recommended set
 * is exactly the set of built-in rules whose own metadata says
 * `recommended: true`, which is what `@eslint/js` publishes, so it is read from
 * the installed ESLint directly and cannot drift from it.
 */
export function eslintRecommended(): Linter.Config {
  const rules: Partial<Linter.RulesRecord> = {}
  for (const [name, rule] of builtinRules) {
    if (rule.meta?.docs?.recommended === true && rule.meta.deprecated === undefined) {
      rules[name] = 'error'
    }
  }
  return { name: 'mfe/eslint-recommended', rules }
}

/** The MFE plugin itself, registered under the `mfe` namespace. */
export const mfePlugin: ESLint.Plugin = {
  meta: { name: '@company/eslint-plugin-mfe', version: '0.1.0' },
  rules: mfeRules,
}

export interface BaseLanguageOptions {
  readonly tsconfigRootDir?: string | undefined
  readonly files?: readonly string[] | undefined
}

/**
 * Parser and type-aware program wiring. Type-aware linting is not optional in
 * either preset: `no-floating-promises` and the `no-unsafe-*` family are the
 * rules that catch the mount and contract failures this framework is most
 * exposed to, and none of them work without a program.
 */
export function languageConfig(options: BaseLanguageOptions = {}): Linter.Config {
  const parserOptions: Record<string, unknown> = { projectService: true }
  if (options.tsconfigRootDir !== undefined) {
    parserOptions['tsconfigRootDir'] = options.tsconfigRootDir
  }
  return {
    name: 'mfe/language-options',
    files: [...(options.files ?? TS_FILES)],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parser: asParser(tseslint.parser),
      parserOptions,
    },
  }
}

/** Async correctness: a dropped promise is a mount that never settles. */
export const asyncCorrectness: Linter.Config = {
  name: 'mfe/async-correctness',
  files: [...TS_FILES],
  rules: {
    '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true, ignoreIIFE: false }],
    '@typescript-eslint/no-misused-promises': [
      'error',
      { checksVoidReturn: { attributes: false }, checksConditionals: true, checksSpreads: true },
    ],
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/return-await': ['error', 'always'],
    'no-async-promise-executor': 'error',
    'require-atomic-updates': 'error',
  },
}

/**
 * Type safety. The `no-unsafe-*` family is what keeps an `any` arriving from a
 * remote module (a federated import is `any` until someone types it) from
 * spreading silently through the host.
 */
export const typeSafety: Linter.Config = {
  name: 'mfe/type-safety',
  files: [...TS_FILES],
  rules: {
    '@typescript-eslint/no-explicit-any': ['error', { fixToUnknown: false, ignoreRestArgs: false }],
    '@typescript-eslint/no-unsafe-argument': 'error',
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',
    '@typescript-eslint/no-unsafe-declaration-merging': 'error',
    '@typescript-eslint/no-unsafe-enum-comparison': 'error',
    '@typescript-eslint/no-unsafe-function-type': 'error',
    // Assertions have to be justified: `as` hides exactly the mismatches a
    // cross-package contract is supposed to surface.
    '@typescript-eslint/consistent-type-assertions': [
      'error',
      { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
    ],
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    // A new lifecycle state or error code has to be handled everywhere it is
    // switched on, rather than silently falling through.
    '@typescript-eslint/switch-exhaustiveness-check': [
      'error',
      { allowDefaultCaseForExhaustiveSwitch: false, considerDefaultExhaustiveForUnions: true },
    ],
    'default-case-last': 'error',
    'no-fallthrough': 'error',
  },
}

/** Maintainability. */
export const maintainability: Linter.Config = {
  name: 'mfe/maintainability',
  files: [...TS_FILES],
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        args: 'all',
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': [
      'error',
      { ignoreTypeValueShadow: false, ignoreFunctionTypeParameterNameValueShadow: true },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'separate-type-imports', disallowTypeAnnotations: true },
    ],
    '@typescript-eslint/consistent-type-exports': [
      'error',
      { fixMixedExportsWithInlineTypeSpecifier: false },
    ],
    // `verbatimModuleSyntax` is on across the repository: an unmarked type
    // import survives into the emitted module graph and can pull a package into
    // a bundle that was only ever meant to know its types.
    '@typescript-eslint/no-import-type-side-effects': 'error',
    // A suppression has to say why, in a sentence a reviewer can disagree with.
    '@typescript-eslint/ban-ts-comment': [
      'error',
      {
        'ts-expect-error': { descriptionFormat: '^: .{10,}$' },
        'ts-ignore': true,
        'ts-nocheck': true,
        'ts-check': false,
        minimumDescriptionLength: 10,
      },
    ],
    '@typescript-eslint/no-empty-object-type': 'error',
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-console': ['error', { allow: ['warn', 'error'] }],
  },
}

/**
 * React correctness and React Compiler compatibility.
 *
 * `eslint-plugin-react-hooks` 7 ships the compiler's own diagnostics as ESLint
 * rules. `recommended-latest` turns on the ones the compiler team considers safe
 * defaults; the block below adds the remaining compiler diagnostics, each of
 * which reports code the compiler would otherwise have to bail out on. An MFE
 * that bails out silently loses the memoisation the host sized its performance
 * budget around, so they are on rather than off.
 */
export function reactCorrectness(files: readonly string[]): Linter.Config[] {
  const recommended = asConfigs([reactHooks.configs.flat['recommended-latest']])
  return [
    ...withFiles(recommended, files, 'mfe/react-hooks-recommended'),
    {
      name: 'mfe/react-compiler',
      files: [...files],
      rules: {
        // Not enabled by `recommended-latest`; every one of them is a case where
        // React Compiler cannot compile the component or the hook.
        'react-hooks/capitalized-calls': 'error',
        'react-hooks/exhaustive-effect-dependencies': 'warn',
        'react-hooks/memo-dependencies': 'error',
        'react-hooks/memoized-effect-dependencies': 'warn',
        'react-hooks/no-deriving-state-in-effects': 'error',
        'react-hooks/void-use-memo': 'error',
        'react-hooks/rule-suppression': 'warn',
        // Also set by `recommended-latest`, repeated so the compiler contract
        // reads as one block rather than two.
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'error',
        'react-hooks/purity': 'error',
        'react-hooks/refs': 'error',
        'react-hooks/immutability': 'error',
        'react-hooks/globals': 'error',
        'react-hooks/set-state-in-render': 'error',
        'react-hooks/set-state-in-effect': 'error',
        'react-hooks/static-components': 'error',
        'react-hooks/preserve-manual-memoization': 'error',
        'react-hooks/error-boundaries': 'error',
        'react-hooks/incompatible-library': 'error',
        'react-hooks/unsupported-syntax': 'warn',
        'react-hooks/use-memo': 'error',
        'react-hooks/config': 'error',
        'react-hooks/gating': 'error',
      },
    },
  ]
}

export { tseslint }
