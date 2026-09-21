/**
 * Patching a shared global is action at a distance: it breaks anything else that wraps those
 * methods, and two routers patching history fight over the URL (§1).
 */

import type { Rule, SourceCode } from 'eslint'
import type { AnyNode, MemberExpression } from '../util/ast.ts'
import { asNode, staticPropertyName } from '../util/ast.ts'
import { isGlobalBinding, resolveGlobalObject } from '../util/scope.ts'
import { docsUrl } from '../util/docs.ts'

type PatchKind = 'fetch' | 'history' | 'listeners'

const HISTORY_METHODS: ReadonlySet<string> = new Set(['pushState', 'replaceState'])
const LISTENER_METHODS: ReadonlySet<string> = new Set(['addEventListener', 'removeEventListener'])

/** Non-global-object names this rule has to recognise as their own owner. */
const KNOWN_GLOBALS: ReadonlySet<string> = new Set(['document', 'history'])

function classify(
  sourceCode: SourceCode,
  objectNode: AnyNode,
  property: string | null,
): PatchKind | null {
  if (property === null) return null
  const owner = resolveGlobalObject(sourceCode, objectNode, KNOWN_GLOBALS)
  if (owner === null) return null

  if (owner === 'globalThis') {
    if (property === 'fetch') return 'fetch'
    if (property === 'history') return 'history'
    if (LISTENER_METHODS.has(property)) return 'listeners'
    return null
  }
  if (owner === 'history' && HISTORY_METHODS.has(property)) return 'history'
  if (owner === 'document' && LISTENER_METHODS.has(property)) return 'listeners'
  return null
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow patching shared globals (fetch, the History API, event-listener registration) from MFE or framework code.',
      recommended: true,
      url: docsUrl('no-global-patching'),
    },
    // No fix and no suggestion: the repair changes which object every call site talks to.
    schema: [],
    messages: {
      fetch:
        "Patching `{{target}}` replaces `fetch` for the shell and for every other MFE in this page, and the last bundle to evaluate wins. Wrap your own requests instead: call `fetch` through a module-local client in this MFE and pass `useMfeSignal()` (@company/mfe-react) as the request signal so the call is cancelled on unmount. Page-wide instrumentation is the shell's to install, once.",
      history:
        "Patching `{{target}}` hijacks navigation for the whole page, so the host router and the other MFEs learn about a navigation only by accident. Navigate through the framework instead: `navigate` or `Link` from your App's boundary router, which already resolve under the MFE base path, or the host `BoundaryNavigator` (@company/mfe-host) in the shell.",
      listeners:
        'Patching `{{target}}` changes event dispatch for every MFE and outlives your own unmount. Register listeners normally and let the framework tear them down: `target.addEventListener(type, handler, { signal: useMfeSignal() })`, since @company/mfe-react aborts that signal on unmount.',
    },
  },

  create(context) {
    const { sourceCode } = context

    function report(node: AnyNode, kind: PatchKind): void {
      context.report({ node, messageId: kind, data: { target: sourceCode.getText(node) } })
    }

    function checkWriteTarget(target: AnyNode): void {
      if (target.type === 'MemberExpression') {
        const kind = classify(sourceCode, asNode(target.object), staticPropertyName(target))
        if (kind !== null) report(target, kind)
        return
      }
      // `fetch = ...`, `addEventListener = ...`: the same patch, no receiver.
      if (target.type === 'Identifier' && isGlobalBinding(sourceCode, target, target.name)) {
        const { name } = target
        if (name === 'fetch') report(target, 'fetch')
        else if (name === 'history') report(target, 'history')
        else if (LISTENER_METHODS.has(name)) report(target, 'listeners')
      }
    }

    return {
      AssignmentExpression(node) {
        checkWriteTarget(asNode(node.left))
      },

      UnaryExpression(node) {
        if (node.operator !== 'delete') return
        checkWriteTarget(asNode(node.argument))
      },

      CallExpression(node) {
        // `Object.defineProperty(globalThis, 'fetch', ...)` is replacement under another spelling.
        const callee = node.callee
        if (callee.type !== 'MemberExpression') return
        if (staticPropertyName(asNode(callee) as MemberExpression) !== 'defineProperty') return
        const receiver = callee.object
        if (receiver.type !== 'Identifier') return
        if (receiver.name !== 'Object' && receiver.name !== 'Reflect') return

        const [targetArg, nameArg] = node.arguments
        if (targetArg === undefined || nameArg === undefined) return
        if (nameArg.type !== 'Literal' || typeof nameArg.value !== 'string') return

        const kind = classify(sourceCode, asNode(targetArg), nameArg.value)
        if (kind === null) return
        context.report({
          node,
          messageId: kind,
          data: { target: `${sourceCode.getText(asNode(targetArg))}.${nameArg.value}` },
        })
      },
    }
  },
}

export default rule
