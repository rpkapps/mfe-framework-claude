import { Linter } from 'eslint'
import type { Rule } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import { asParser } from '../configs/shared.ts'
import { asNode } from './ast.ts'
import { isGlobalBinding, resolveCalleeBinding, resolveGlobalObject } from './scope.ts'

/** A probe rule reports whatever the helper answers, so the helpers are tested directly. */
function probe(code: string, visit: (context: Rule.RuleContext) => Rule.RuleListener): string[] {
  const linter = new Linter()
  const messages = linter.verify(code, {
    plugins: {
      probe: {
        rules: {
          probe: {
            meta: { type: 'problem', schema: [], messages: { seen: '{{value}}' } },
            create: visit,
          },
        },
      },
    },
    languageOptions: {
      parser: asParser(tseslint.parser),
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { window: 'readonly', history: 'readonly' },
    },
    rules: { 'probe/probe': 'error' },
  })
  return messages.map(message => message.message)
}

describe('resolveCalleeBinding', () => {
  function bindings(code: string): string[] {
    return probe(code, context => ({
      CallExpression(node) {
        const binding = resolveCalleeBinding(context.sourceCode, asNode(node.callee))
        context.report({
          node,
          messageId: 'seen',
          data: { value: binding === null ? 'local' : `${binding.source}#${binding.imported}` },
        })
      },
    }))
  }

  it('resolves a plain named import', () => {
    expect(bindings("import { createWidget } from '@company/mfe-react'\ncreateWidget()")).toEqual([
      '@company/mfe-react#createWidget',
    ])
  })

  it('resolves an aliased import back to its exported name', () => {
    expect(bindings("import { createWidget as mk } from '@company/mfe-react'\nmk()")).toEqual([
      '@company/mfe-react#createWidget',
    ])
  })

  it('resolves a namespace member', () => {
    expect(bindings("import * as mfe from '@company/mfe-react'\nmfe.createWidget()")).toEqual([
      '@company/mfe-react#createWidget',
    ])
  })

  it('follows a local alias of an import', () => {
    expect(
      bindings("import { createWidget } from '@company/mfe-react'\nconst mk = createWidget\nmk()"),
    ).toEqual(['@company/mfe-react#createWidget'])
  })

  it('reports a locally declared function as local, not as the import it shadows', () => {
    expect(bindings('function createWidget() {}\ncreateWidget()')).toEqual(['local'])
  })

  it('reports a parameter that shadows an import as local', () => {
    const code =
      "import { createWidget } from '@company/mfe-react'\nfunction make(createWidget: () => void) {\n  createWidget()\n}"
    expect(bindings(code)).toEqual(['local'])
  })
})

describe('resolveGlobalObject', () => {
  const KNOWN = new Set(['document', 'history'])

  function owners(code: string): string[] {
    return probe(code, context => ({
      MemberExpression(node) {
        const owner = resolveGlobalObject(context.sourceCode, asNode(node.object), KNOWN)
        context.report({ node, messageId: 'seen', data: { value: owner ?? 'none' } })
      },
    }))
  }

  it('canonicalises the global-object aliases', () => {
    expect(owners('window.fetch')).toEqual(['globalThis'])
    expect(owners('globalThis.fetch')).toEqual(['globalThis'])
    expect(owners('self.fetch')).toEqual(['globalThis'])
  })

  it('resolves a well-known global reached through the global object', () => {
    // Member expressions are visited outermost first, so the receiver of `.pushState` comes first.
    expect(owners('window.history.pushState')).toEqual(['history', 'globalThis'])
  })

  it('refuses a shadowed name', () => {
    expect(owners('const history = makeHistory()\nhistory.pushState')).toEqual(['none'])
  })

  it('sees through a TypeScript assertion', () => {
    expect(owners('(window as Window).fetch')).toEqual(['globalThis'])
  })
})

describe('isGlobalBinding', () => {
  function answers(code: string, name: string): string[] {
    return probe(code, context => ({
      Identifier(node) {
        if (node.name !== name) return
        context.report({
          node,
          messageId: 'seen',
          data: { value: String(isGlobalBinding(context.sourceCode, asNode(node), node.name)) },
        })
      },
    }))
  }

  it('accepts a declared global and an unresolved name', () => {
    expect(answers('window.x', 'window')).toEqual(['true'])
    expect(answers('localStorage.getItem(k)', 'localStorage')).toEqual(['true'])
  })

  it('rejects any local, imported or parameter binding of the same name', () => {
    expect(answers('const localStorage = fake\nlocalStorage.getItem(k)', 'localStorage')).toEqual([
      'false',
      'false',
    ])
    // Three occurrences: the imported name, the local binding it creates, and the use site.
    expect(answers("import { window } from './shim.ts'\nwindow.x", 'window')).toEqual([
      'false',
      'false',
      'false',
    ])
    expect(answers('function f(history) {\n  history.pushState()\n}', 'history')).toEqual([
      'false',
      'false',
    ])
  })
})
