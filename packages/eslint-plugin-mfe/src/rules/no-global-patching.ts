/**
 * Patching a shared global is action at a distance: it breaks anything else that wraps those
 * methods, and two routers patching history fight over the URL (§1).
 */

import type { Rule, SourceCode } from 'eslint'
import type { AnyNode, MemberExpression } from '../util/ast.ts'
import { asNode, staticPropertyName } from '../util/ast.ts'
import { isGlobalBinding, resolveGlobalObject } from '../util/scope.ts'
import { optionRecord, stringOption } from '../util/options.ts'
import { docsUrl } from '../util/docs.ts'

type PatchKind = 'fetch' | 'history' | 'listeners'

const HISTORY_METHODS: ReadonlySet<string> = new Set(['pushState', 'replaceState'])
const LISTENER_METHODS: ReadonlySet<string> = new Set(['addEventListener', 'removeEventListener'])

/** Non-global-object names this rule has to recognise as their own owner. */
const KNOWN_GLOBALS: ReadonlySet<string> = new Set(['document', 'history'])

/**
 * The repair each message points to names an adapter API, so a container written against a
 * different adapter would be pointed at the wrong hooks. The author preset for that adapter
 * supplies its own values; these are the React defaults, unchanged from before this option existed.
 */
const DEFAULT_SIGNAL_HOOK = 'useMfeSignal()'
const DEFAULT_SIGNAL_MODULE = '@company/mfe-react'
const DEFAULT_NAVIGATION_HINT =
  "`navigate` or `Link` from your App's boundary router, which already resolve under the MFE base path"
const DEFAULT_NAVIGATOR_MODULE = '@company/mfe-runtime'

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
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          signalHook: {
            type: 'string',
            description:
              "The adapter's abort-signal hook, called out in the fetch and listener repairs.",
          },
          signalModule: {
            type: 'string',
            description: 'The adapter module `signalHook` comes from.',
          },
          navigationHint: {
            type: 'string',
            description: "How to navigate through this adapter's App boundary router.",
          },
          navigatorModule: {
            type: 'string',
            description: 'The module the host `BoundaryNavigator` comes from.',
          },
        },
      },
    ],
    messages: {
      fetch:
        "Patching `{{target}}` replaces `fetch` for the shell and for every other MFE in this page, and the last bundle to evaluate wins. Wrap your own requests instead: call `fetch` through a module-local client in this MFE and pass `{{signalHook}}` ({{signalModule}}) as the request signal so the call is cancelled on unmount. Page-wide instrumentation is the shell's to install, once.",
      history:
        'Patching `{{target}}` hijacks navigation for the whole page, so the host router and the other MFEs learn about a navigation only by accident. Navigate through the framework instead: {{navigationHint}}, or the host `BoundaryNavigator` ({{navigatorModule}}) in the shell.',
      listeners:
        'Patching `{{target}}` changes event dispatch for every MFE and outlives your own unmount. Register listeners normally and let the framework tear them down: `target.addEventListener(type, handler, { signal: {{signalHook}} })`, since {{signalModule}} aborts that signal on unmount.',
    },
  },

  create(context) {
    const { sourceCode } = context
    const options = optionRecord(context.options)
    const signalHook = stringOption(options, 'signalHook', DEFAULT_SIGNAL_HOOK)
    const signalModule = stringOption(options, 'signalModule', DEFAULT_SIGNAL_MODULE)
    const navigationHint = stringOption(options, 'navigationHint', DEFAULT_NAVIGATION_HINT)
    const navigatorModule = stringOption(options, 'navigatorModule', DEFAULT_NAVIGATOR_MODULE)

    function dataFor(kind: PatchKind, target: string): Record<string, string> {
      if (kind === 'history') return { target, navigationHint, navigatorModule }
      return { target, signalHook, signalModule }
    }

    function report(node: AnyNode, kind: PatchKind): void {
      context.report({ node, messageId: kind, data: dataFor(kind, sourceCode.getText(node)) })
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
          data: dataFor(kind, `${sourceCode.getText(asNode(targetArg))}.${nameArg.value}`),
        })
      },
    }
  },
}

export default rule
