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

/**
 * The plugins a vendor config array registers, collected so this package can
 * register the *same objects* alongside its own rule blocks.
 *
 * Flat config resolves a rule's plugin from the config objects that match the
 * file being linted, so a block that turns on `@typescript-eslint/...` has to
 * carry the plugin itself. Copying the reference out of the vendor config
 * rather than importing it a second time keeps the identity, which is what lets
 * ESLint merge the two registrations instead of rejecting them as a redefinition.
 */
export function pluginsOf(configs: readonly Linter.Config[]): Record<string, ESLint.Plugin> {
  const plugins: Record<string, ESLint.Plugin> = {}
  for (const config of configs) Object.assign(plugins, config.plugins ?? {})
  return plugins
}

/**
 * Narrows a scope glob to the files the preset was asked to cover.
 *
 * A nested `files` entry is an AND in flat config, so the cross product of the
 * preset's patterns with one scope pattern is "inside this scope *and* inside
 * the preset". Without it a zone would reach files the caller never asked for,
 * which is how a block ends up applying where the parser and the plugin do not.
 */
export function intersectFiles(files: readonly string[], scope: string): (string | string[])[] {
  return files.map(pattern => [pattern, scope])
}

/** typescript-eslint's type-checked recommended configuration, and its plugin. */
export const typeCheckedConfigs: Linter.Config[] = asConfigs(
  tseslint.configs.recommendedTypeChecked,
)
export const typeScriptPlugins: Record<string, ESLint.Plugin> = pluginsOf(typeCheckedConfigs)

/**
 * Copies a vendor config array, scoping every entry to `files` and naming each
 * one.
 *
 * Every entry also gets the plugins the array as a whole registers. A vendor
 * array normally splits "register the plugin" and "turn the rules on" across
 * sibling objects, which works only while both keep the same scope; merging the
 * registration into each entry makes every object in the preset self-sufficient,
 * so re-scoping one of them can never strand its rules. The plugin objects are
 * the vendor's own, so ESLint merges the duplicate registrations rather than
 * rejecting them.
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

/**
 * Type safety. The `no-unsafe-*` family is what keeps an `any` arriving from a
 * remote module (a federated import is `any` until someone types it) from
 * spreading silently through the host.
 */
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
}

/** Maintainability. */
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
}

/**
 * Scoped exceptions for test files.
 *
 * Every entry here is off for a reason specific to what a test *is*, and the
 * scope is test files rather than whole packages. Everything that catches a real
 * defect in a test stays on, deliberately: `no-floating-promises`, the
 * `no-unsafe-*` family and the React Hooks rules all find genuine bugs in test
 * code, and a flaky test is usually one of them.
 */
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
      // A test for the patching rule has to patch a global to have anything to
      // assert on, and a storage test has to reach the storage it is verifying.
      'mfe/no-global-patching': 'off',
      'mfe/no-raw-storage': 'off',
      // `unbound-method` exists to catch a method reference that will lose its
      // `this` when it is eventually called. In `expect(obj.method).toHaveBeenCalled()`
      // and `vi.spyOn(obj, 'method')` the reference is never called through the
      // lost binding at all: it is handed to the assertion or the spy as a
      // value to be identified, not invoked. Every report in that position is
      // therefore a false positive.
      '@typescript-eslint/unbound-method': 'off',
      // A test helper or fake is frequently `async` on purpose, to match the
      // signature of the real thing it stands in for, while awaiting nothing.
      // The rule cannot distinguish that from a genuinely forgotten `await`.
      '@typescript-eslint/require-await': 'off',
      // Under `noUncheckedIndexedAccess` every indexed read in an assertion is
      // `T | undefined`, so `results[0]!.line` is the idiomatic spelling; the
      // alternative, `expect(results[0]).toBeDefined()` followed by optional
      // chaining everywhere, adds noise without adding safety. The failure mode
      // also differs by context: in production a wrong `!` is a crash in front
      // of a user, while in a test it fails that test immediately with a clear
      // error, which is exactly what a test is for. The rule stays on in
      // production code, where that argument does not hold.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  }
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
      plugins: pluginsOf(recommended),
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
