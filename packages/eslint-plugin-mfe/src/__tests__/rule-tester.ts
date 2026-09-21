/**
 * A `RuleTester` wired to Vitest, so each case is a named test rather than one opaque assertion.
 * The rules use no type information, so the parser alone supplies the AST and the scope manager.
 */

import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, it } from 'vitest'
import { asParser } from '../configs/shared.ts'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

/** So the rules exercise both the declared-global and the unresolved-name paths in scope analysis. */
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
