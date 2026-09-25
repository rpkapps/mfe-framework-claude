/**
 * A Widget owns neither the URL nor the document head, so the last one to render wins. Ownership
 * is declared: the rule is inert until `widgetScopes` is configured.
 */

import type { Rule } from 'eslint'
import type { AnyNode, MemberExpression } from '../util/ast.ts'
import { asNode, staticPropertyName, unwrapExpression } from '../util/ast.ts'
import { resolveGlobalObject } from '../util/scope.ts'
import { matchesAnyScope } from '../util/file-scope.ts'
import {
  optionRecord,
  stringArrayOption,
  stringOption,
  widgetScopeSchema,
} from '../util/options.ts'
import { docsUrl } from '../util/docs.ts'

/**
 * How this Widget's render calls into `emit`, named in every repair. React's Widget receives it
 * as a prop of its render function; a different adapter names its own access here.
 */
const DEFAULT_EMIT_ACCESS = 'its render props'

const HISTORY_METHODS: ReadonlySet<string> = new Set([
  'pushState',
  'replaceState',
  'back',
  'forward',
  'go',
])

const HEAD_MUTATORS: ReadonlySet<string> = new Set([
  'appendChild',
  'append',
  'prepend',
  'insertBefore',
  'replaceChild',
  'removeChild',
  'replaceChildren',
  'insertAdjacentHTML',
  'insertAdjacentElement',
])

const HEAD_WRITE_PROPERTIES: ReadonlySet<string> = new Set(['innerHTML', 'textContent'])

const DOCUMENT_QUERIES: ReadonlySet<string> = new Set(['querySelector', 'querySelectorAll'])

/** Selectors that can only be aimed at shell-owned head metadata. */
const HEAD_SELECTOR = /(^|[\s,>+~])(title|base)\b|link\s*\[[^\]]*\brel\b|meta\s*\[/i

const KNOWN_GLOBALS: ReadonlySet<string> = new Set(['document', 'history'])

type EffectMessageId = 'history' | 'title' | 'headMetadata'

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow page-global side effects (History navigation, document title, favicon and meta mutation) inside explicitly configured Widget source scopes.',
      recommended: true,
      url: docsUrl('no-widget-global-effects'),
    },
    // No fix and no suggestion: the repair changes the Widget's declared contract.
    schema: widgetScopeSchema(
      "How this Widget's render reaches `emit`, named in the repair. Defaults to React's render props.",
    ),
    messages: {
      history:
        "A Widget does not drive the URL: `{{access}}` navigates the whole page, and the host router, the owning App and every sibling MFE learn about it only by accident. Declare a navigation output in this Widget's `outputSchema` and call `emit('navigate', { to })` from {{emitAccess}}; the owning App receives the output and navigates with its own boundary router, or the shell with the host `BoundaryNavigator`.",
      title:
        "`{{access}}` is shell-owned: several Widgets can be mounted at once, so the last one to render would win and the tab title would flicker. Declare a title output in this Widget's `outputSchema` and call `emit('title', { text })` from {{emitAccess}}; the owning App receives the output and sets what it owns.",
      headMetadata:
        "Document head metadata (favicon, `<meta>`, `<title>`) belongs to the shell; a Widget that reaches for `{{access}}` changes the page for every other MFE and leaves the change behind on unmount. Declare an output for the value in this Widget's `outputSchema` and `emit` it from {{emitAccess}}; the owning App receives the output and applies it to what it owns, which is also what reverts it.",
    },
  },

  create(context) {
    const options = optionRecord(context.options)
    const widgetScopes = stringArrayOption(options, 'widgetScopes', [])
    if (!matchesAnyScope(context.filename, widgetScopes)) return {}
    const emitAccess = stringOption(options, 'emitAccess', DEFAULT_EMIT_ACCESS)

    const { sourceCode } = context

    function owner(node: AnyNode): string | null {
      return resolveGlobalObject(sourceCode, node, KNOWN_GLOBALS)
    }

    function report(node: AnyNode, messageId: EffectMessageId): void {
      context.report({
        node,
        messageId,
        data: { access: sourceCode.getText(node), emitAccess },
      })
    }

    /** `document.head`, resolved through scope rather than by name. */
    function isDocumentHead(expression: AnyNode): boolean {
      const node = unwrapExpression(expression)
      if (node.type !== 'MemberExpression') return false
      if (staticPropertyName(node) !== 'head') return false
      return owner(asNode(node.object)) === 'document'
    }

    return {
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression') return
        const calleeNode = asNode(callee) as MemberExpression
        const method = staticPropertyName(calleeNode)
        if (method === null) return
        const receiver = asNode(callee.object)

        if (HISTORY_METHODS.has(method) && owner(receiver) === 'history') {
          report(calleeNode, 'history')
          return
        }

        if (HEAD_MUTATORS.has(method) && isDocumentHead(receiver)) {
          report(calleeNode, 'headMetadata')
          return
        }

        if (DOCUMENT_QUERIES.has(method) && owner(receiver) === 'document') {
          const [selector] = node.arguments
          if (
            selector !== undefined &&
            selector.type === 'Literal' &&
            typeof selector.value === 'string' &&
            HEAD_SELECTOR.test(selector.value)
          ) {
            report(node, 'headMetadata')
          }
        }
      },

      AssignmentExpression(node) {
        const left = node.left
        if (left.type !== 'MemberExpression') return
        const leftNode = asNode(left) as MemberExpression
        const property = staticPropertyName(leftNode)
        if (property === null) return
        const receiver = asNode(left.object)

        if (property === 'title' && owner(receiver) === 'document') {
          report(leftNode, 'title')
          return
        }
        if (HEAD_WRITE_PROPERTIES.has(property) && isDocumentHead(receiver)) {
          report(leftNode, 'headMetadata')
        }
      },
    }
  },
}

export default rule
