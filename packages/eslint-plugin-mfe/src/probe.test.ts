import { RuleTester } from 'eslint'
import type { Rule } from 'eslint'
import tseslint from 'typescript-eslint'
import { afterAll, describe, it } from 'vitest'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const rule: Rule.RuleModule = {
  meta: { type: 'problem', docs: { description: 'probe' }, schema: [], messages: { x: 'nope {{n}}' } },
  create(context) {
    return {
      Identifier(node) {
        const scope = context.sourceCode.getScope(node)
        if (node.name === 'banned') context.report({ node, messageId: 'x', data: { n: String(scope.type) } })
      },
    }
  },
}

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser as never, ecmaVersion: 2023, sourceType: 'module' },
})

ruleTester.run('probe', rule, {
  valid: ['const ok: number = 1'],
  invalid: [{ code: 'const banned = 1 as const', errors: [{ messageId: 'x' }] }],
})
