/**
 * `mfe/no-global-patching`.
 *
 * A micro-frontend shares one realm with the shell and with every other MFE.
 * Replacing `fetch`, the History API or the event-listener plumbing is therefore
 * not a local decision: it changes behaviour for code the author has never seen,
 * it survives the MFE's own unmount, and the winner is whichever bundle happened
 * to evaluate last. The framework owns those seams, so an MFE asks for them
 * rather than taking them.
 *
 * The global is resolved through scope analysis, so a local
 * `const window = createFakeWindow()` or a `history` imported from the router is
 * not mistaken for the real global.
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

/**
 * Which shared seam does `<object>.<property>` name, if any? Returns `null` for
 * anything that is not a patch of a shared global.
 */
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

/** `fetch = ...`, `addEventListener = ...`: the same patch without a receiver. */
function classifyBareGlobal(sourceCode: SourceCode, node: AnyNode, name: string): PatchKind | null {
  if (!isGlobalBinding(sourceCode, node, name)) return null
  if (name === 'fetch') return 'fetch'
  if (name === 'history') return 'history'
  if (LISTENER_METHODS.has(name)) return 'listeners'
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
    // No fix and no suggestion: swapping a monkey patch for a framework seam
    // changes which object every call site talks to, which no textual edit can
    // do safely.
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
      if (target.type === 'Identifier') {
        const kind = classifyBareGlobal(sourceCode, target, target.name)
        if (kind !== null) report(target, kind)
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
        // `Object.defineProperty(globalThis, 'fetch', ...)` and the Reflect twin
        // are replacement under another spelling.
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
