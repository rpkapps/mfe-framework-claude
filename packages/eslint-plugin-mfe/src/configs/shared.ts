/**
 * The pieces both presets are built from. The presets are plain flat-config
 * arrays, so a consumer can spread them, reorder them and override any single
 * rule afterwards. Nothing here hides behind an opaque "extends".
 */

import type { ESLint, Linter } from 'eslint'
import { builtinRules } from 'eslint/use-at-your-own-risk'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import { rules as mfeRules } from '../rules/index.ts'

export const TS_FILES: readonly string[] = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']

/**
 * `Linter.Config` and the "compatible" config types typescript-eslint and the
 * React and TanStack plugins publish describe the same objects with different
 * precision: those plugins type loosely so they work across ESLint majors. This
 * assertion is the whole of that mismatch, kept in one place.
 */
export function asConfigs(value: unknown): Linter.Config[] {
  return value as Linter.Config[]
}

/** The same mismatch, for the parser object typescript-eslint publishes. */
export function asParser(value: unknown): Linter.Parser {
  return value as Linter.Parser
}

/**
 * The plugins a vendor config array registers. Flat config resolves a rule's
 * plugin from the config objects that match the file, so a block that turns on
 * `@typescript-eslint/...` has to carry the plugin itself. Copying the
 * reference rather than importing it again keeps the identity, which is what
 * lets ESLint merge the registrations instead of rejecting a redefinition.
 */
function pluginsOf(configs: readonly Linter.Config[]): Record<string, ESLint.Plugin> {
  const plugins: Record<string, ESLint.Plugin> = {}
  for (const config of configs) Object.assign(plugins, config.plugins ?? {})
  return plugins
}

/**
 * Narrows a scope glob to the files the preset covers. A nested `files` entry
 * is an AND in flat config, so without this a zone would reach files the caller
 * never asked for — which is where the parser and the plugin are not set.
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
 * Copies a vendor config array, scoping and naming every entry, and merging the
 * array's plugin registrations into each one. A vendor array normally splits
 * "register the plugin" from "turn the rules on" across sibling objects, which
 * works only while both keep the same scope; merging makes every object
 * self-sufficient, so re-scoping one can never strand its rules.
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
 * ESLint's recommended baseline, read from the installed ESLint so it cannot
 * drift from it. Depending on `@eslint/js` only to read a rule list would pin a
 * second copy of ESLint's metadata; the recommended set is exactly the built-in
 * rules whose own metadata says `recommended: true`.
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

/**
 * Parser and type-aware program wiring. Type-aware linting is not optional in
 * either preset: `no-floating-promises` and the `no-unsafe-*` family catch the
 * mount and contract failures this framework is most exposed to, and none of
 * them work without a program.
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

/**
 * Type safety. The `no-unsafe-*` family keeps an `any` arriving from a remote
 * module — a federated import is `any` until someone types it — from spreading
 * silently through the host.
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
      // `as` hides exactly the mismatches a cross-package contract surfaces.
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
      // import survives into the emitted module graph and can pull a package
      // into a bundle that was only ever meant to know its types.
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
 * Resolves the files the React and React Compiler rules apply to, defaulting to
 * everything the preset covers. A repository that narrows it is saying "these
 * are the packages with React in them": a package without React gets false
 * positives from any API whose name collides with a hook — Rspack's
 * `rule.use(...)` reads as React's `use()` to `rules-of-hooks` — and the fix is
 * to stop applying React rules there, not to suppress them. Always intersected
 * with `files`, because a block that reached past them would apply where the
 * parser is not set.
 */
export function resolveReactFiles(
  files: readonly string[],
  reactFiles: readonly string[] | undefined,
): (string | string[])[] {
  if (reactFiles === undefined) return [...files]
  return reactFiles.flatMap(scope => intersectFiles(files, scope))
}

/**
 * Scoped exceptions for test files. Every entry is off for a reason specific to
 * what a test *is*, and the scope is test files rather than whole packages.
 * Everything that catches a real defect in a test stays on.
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
      // assert on, and a storage test has to reach the storage it verifies.
      'mfe/no-global-patching': 'off',
      'mfe/no-raw-storage': 'off',
      // In `expect(obj.method)` and `vi.spyOn(obj, 'method')` the reference is
      // handed to the assertion or the spy to be identified, never called
      // through the lost binding, so every report in that position is false.
      '@typescript-eslint/unbound-method': 'off',
      // A test double is frequently `async` to match the signature of the real
      // thing while awaiting nothing, which the rule cannot tell from a
      // forgotten `await`.
      '@typescript-eslint/require-await': 'off',
      // Under `noUncheckedIndexedAccess` every indexed read in an assertion is
      // `T | undefined`, so `results[0]!.line` is the idiomatic spelling. A
      // wrong `!` in a test fails that test with a clear error; in production it
      // crashes in front of a user, which is why the rule stays on there.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  }
}

/**
 * React correctness and React Compiler compatibility. `recommended-latest` turns
 * on the diagnostics the compiler team considers safe defaults; the block below
 * adds the rest, plus the two `recommended-latest` only warns about. Each one
 * reports code the compiler would otherwise bail out on, and an MFE that bails
 * out silently loses the memoisation the host sized its budget around.
 */
export function reactCorrectness(files: readonly (string | string[])[]): Linter.Config[] {
  const recommended = asConfigs([reactHooks.configs.flat['recommended-latest']])
  return [
    ...withFiles(recommended, files, 'mfe/react-hooks-recommended'),
    {
      name: 'mfe/react-compiler',
      files: files.map(pattern => (Array.isArray(pattern) ? [...pattern] : pattern)),
      plugins: pluginsOf(recommended),
      rules: {
        'react-hooks/capitalized-calls': 'error',
        'react-hooks/exhaustive-effect-dependencies': 'warn',
        'react-hooks/memo-dependencies': 'error',
        'react-hooks/memoized-effect-dependencies': 'warn',
        'react-hooks/no-deriving-state-in-effects': 'error',
        'react-hooks/void-use-memo': 'error',
        'react-hooks/rule-suppression': 'warn',
        // Raised from the warning `recommended-latest` sets.
        'react-hooks/exhaustive-deps': 'error',
        'react-hooks/incompatible-library': 'error',
      },
    },
  ]
}
