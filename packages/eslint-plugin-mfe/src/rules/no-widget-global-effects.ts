/**
 * A Widget owns neither the URL nor the document head, so the last one to render wins. Ownership
 * is declared: the rule is inert until `widgetScopes` is configured.
 */

import type { Rule } from 'eslint'
import type { AnyNode, MemberExpression } from '../util/ast.ts'
import { asNode, staticPropertyName, unwrapExpression } from '../util/ast.ts'
import { resolveGlobalObject } from '../util/scope.ts'
import { matchesAnyScope } from '../util/file-scope.ts'
import { optionRecord, stringArrayOption } from '../util/options.ts'
import { docsUrl } from '../util/docs.ts'

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
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          widgetScopes: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Globs for Widget-owned source files. The rule is inert until a repository declares them; ownership is never guessed from a file name.',
          },
        },
      },
    ],
    messages: {
      history:
        'A Widget does not drive the URL: `{{access}}` navigates the whole page, and the host router, the owning App and every sibling MFE learn about it only by accident. Emit the Widget\'s declared navigation event (`ctx.emit("navigate", { to })`) and let the owning App navigate with its boundary router, or the shell with the host `BoundaryNavigator`.',
      title:
        '`{{access}}` is shell-owned: several Widgets can be mounted at once, so the last one to render would win and the tab title would flicker. Publish the title through the Widget\'s declared outputs (`ctx.emit("titleChange", ...)`) and let the owning App apply it with the host document-metadata API.',
      headMetadata:
        'Document head metadata (favicon, `<meta>`, `<title>`) belongs to the shell; a Widget that reaches for `{{access}}` changes the page for every other MFE and leaves the change behind on unmount. Emit the value from the Widget and let the host document-metadata API apply and revert it.',
    },
  },

  create(context) {
    const options = optionRecord(context.options)
    const widgetScopes = stringArrayOption(options, 'widgetScopes', [])
    if (!matchesAnyScope(context.filename, widgetScopes)) return {}

    const { sourceCode } = context

    function owner(node: AnyNode): string | null {
      return resolveGlobalObject(sourceCode, node, KNOWN_GLOBALS)
    }

    function report(node: AnyNode, messageId: EffectMessageId): void {
      context.report({ node, messageId, data: { access: sourceCode.getText(node) } })
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
