/** The pieces every preset is built from: plain flat-config arrays, spreadable and overridable. */

import type { ESLint, Linter } from 'eslint'
import { builtinRules } from 'eslint/use-at-your-own-risk'
import tseslint from 'typescript-eslint'
import { rules as mfeRules } from '../rules/index.ts'
import type { RestrictedPath, RestrictedPattern } from './restricted-imports.ts'

export const TS_FILES: readonly string[] = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']

export interface PresetOptions {
  /** Root directory for the type-aware program; defaults to the ESLint CWD. */
  readonly tsconfigRootDir?: string | undefined
  /** Defaults to every TypeScript file. */
  readonly files?: readonly string[] | undefined
  /** Narrow to the packages containing React: elsewhere an API named like a hook reports falsely. */
  readonly reactFiles?: readonly string[] | undefined
  /** Files allowed to touch Web Storage directly; every entry has to justify itself (§24). */
  readonly storageAllowedScopes?: readonly string[] | undefined
  /** Widget ownership is declared, never guessed from a path: the rule is inert with none set. */
  readonly widgetScopes?: readonly string[] | undefined
  /** Extra restricted paths and patterns appended to every zone. */
  readonly extraRestrictedPaths?: readonly RestrictedPath[] | undefined
  readonly extraRestrictedPatterns?: readonly RestrictedPattern[] | undefined
}

/** The plugins type their configs loosely to span ESLint majors; this is the whole mismatch. */
export function asConfigs(value: unknown): Linter.Config[] {
  return value as Linter.Config[]
}

/** The same mismatch, for the parser object typescript-eslint publishes. */
export function asParser(value: unknown): Linter.Parser {
  return value as Linter.Parser
}

/**
 * Flat config resolves a rule's plugin from the objects matching the file, and copying the
 * reference rather than importing it again keeps the identity ESLint merges on.
 */
export function pluginsOf(configs: readonly Linter.Config[]): Record<string, ESLint.Plugin> {
  const plugins: Record<string, ESLint.Plugin> = {}
  for (const config of configs) Object.assign(plugins, config.plugins ?? {})
  return plugins
}

/** A nested `files` entry is an AND, so a zone without this reaches files where no parser is set. */
export function intersectFiles(files: readonly string[], scope: string): (string | string[])[] {
  return files.map(pattern => [pattern, scope])
}

export const typeCheckedConfigs: Linter.Config[] = asConfigs(
  tseslint.configs.recommendedTypeChecked,
)
export const typeScriptPlugins: Record<string, ESLint.Plugin> = pluginsOf(typeCheckedConfigs)

/**
 * Copies a vendor config array, scoping and naming every entry and merging the array's plugin
 * registrations into each one, so re-scoping one object can never strand its rules.
 */
export function withFiles(
  configs: readonly Linter.Config[],
  files: readonly (string | string[])[],
  namePrefix: string,
): Linter.Config[] {
  const plugins = pluginsOf(configs)
  return configs.map((config, index) => ({
    ...config,
    name: `${namePrefix}-${String(index)}`,
    files: files.map(pattern => (Array.isArray(pattern) ? [...pattern] : pattern)),
    plugins: { ...plugins, ...config.plugins },
  }))
}

/** ESLint's recommended baseline, read from the installed ESLint so it cannot drift from it. */
export function eslintRecommended(files: readonly string[]): Linter.Config {
  const rules: Partial<Linter.RulesRecord> = {}
  for (const [name, rule] of builtinRules) {
    if (rule.meta?.docs?.recommended === true && rule.meta.deprecated === undefined) {
      rules[name] = 'error'
    }
  }
  return { name: 'mfe/eslint-recommended', files: [...files], rules }
}

export const mfePlugin: ESLint.Plugin = {
  meta: { name: '@company/eslint-plugin-mfe', version: '0.1.0' },
  rules: mfeRules,
}

/**
 * Type-aware linting is not optional in either preset: the `no-unsafe-*` family and
 * `no-floating-promises` catch this framework's mount and contract failures, and need a program.
 */
export function languageConfig(
  options: {
    readonly tsconfigRootDir?: string | undefined
    readonly files?: readonly string[] | undefined
  } = {},
): Linter.Config {
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
export function asyncCorrectness(files: readonly string[]): Linter.Config {
  return {
    name: 'mfe/async-correctness',
    files: [...files],
    plugins: typeScriptPlugins,
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
}

/** A federated import is `any` until typed; `no-unsafe-*` stops it spreading through the host. */
export function typeSafety(files: readonly string[]): Linter.Config {
  return {
    name: 'mfe/type-safety',
    files: [...files],
    plugins: typeScriptPlugins,
    rules: {
      '@typescript-eslint/no-explicit-any': [
        'error',
        { fixToUnknown: false, ignoreRestArgs: false },
      ],
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-declaration-merging': 'error',
      '@typescript-eslint/no-unsafe-enum-comparison': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'error',
      // `as` hides exactly the mismatches a cross-package contract surfaces.
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      // A new lifecycle state or error code has to be handled everywhere it is switched on.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { allowDefaultCaseForExhaustiveSwitch: false, considerDefaultExhaustiveForUnions: true },
      ],
      'default-case-last': 'error',
      'no-fallthrough': 'error',
    },
  }
}

export function maintainability(files: readonly string[]): Linter.Config {
  return {
    name: 'mfe/maintainability',
    files: [...files],
    plugins: typeScriptPlugins,
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
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
          disallowTypeAnnotations: true,
        },
      ],
      '@typescript-eslint/consistent-type-exports': [
        'error',
        { fixMixedExportsWithInlineTypeSpecifier: false },
      ],
      // An unmarked type import survives into the emitted graph and pulls a package into the bundle.
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
}

/**
 * A package without React gets false positives from any API named like a hook (Rspack's
 * `rule.use(...)` reads as React's `use()`), so the repair is to narrow this, not to suppress.
 */
export function resolveReactFiles(
  files: readonly string[],
  reactFiles: readonly string[] | undefined,
): (string | string[])[] {
  if (reactFiles === undefined) return [...files]
  return reactFiles.flatMap(scope => intersectFiles(files, scope))
}

/** Each entry is off for a reason specific to what a test is, and is scoped to test files. */
export function testScopeOverrides(files: readonly string[], name: string): Linter.Config {
  return {
    name,
    files: [
      ...intersectFiles(files, '**/*.test.{ts,tsx,mts,cts}'),
      ...intersectFiles(files, '**/*.spec.{ts,tsx,mts,cts}'),
      ...intersectFiles(files, '**/__tests__/**'),
      ...intersectFiles(files, '**/vitest.setup.{ts,tsx}'),
    ],
    plugins: { ...typeScriptPlugins, mfe: mfePlugin },
    rules: {
      // A test for the patching rule has to patch a global, and a storage test has to reach storage.
      'mfe/no-global-patching': 'off',
      'mfe/no-raw-storage': 'off',
      // The reference is handed to a spy or an assertion to be identified, never called.
      '@typescript-eslint/unbound-method': 'off',
      // A test double is often `async` to match the real signature while awaiting nothing.
      '@typescript-eslint/require-await': 'off',
      // A wrong `!` fails the test with a clear error; in production it crashes in front of a user.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  }
}
