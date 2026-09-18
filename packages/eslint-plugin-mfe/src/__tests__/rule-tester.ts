/**
 * A `RuleTester` wired to Vitest.
 *
 * ESLint's own `RuleTester` announces its cases through whatever `describe` and
 * `it` it is handed; pointing those at Vitest's makes each case a named test in
 * the normal report instead of one opaque assertion.
 *
 * The four rules in this plugin work without type information on purpose, so the
 * tester needs no TypeScript program: the TypeScript parser alone gives the AST
 * and, more importantly, the scope manager the rules resolve bindings through.
 */

import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, it } from 'vitest'
import { asParser } from '../configs/shared.ts'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

/** Globals a browser realm predefines, so the rules exercise both the
 * "declared global" and the "unresolved name" paths through scope analysis. */
const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  history: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'writable',
  self: 'readonly',
  globalThis: 'readonly',
} as const

export function createRuleTester(): RuleTester {
  return new RuleTester({
    languageOptions: {
      parser: asParser(tseslint.parser),
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...BROWSER_GLOBALS },
    },
  })
}
