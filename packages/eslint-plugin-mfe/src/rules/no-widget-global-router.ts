/**
 * The Router analogue of `no-widget-global-effects`: a Widget is an embedded fragment, so it does
 * not own the URL. Angular's `Router` navigates the whole page — the host router, the owning App
 * and every sibling MFE learn about that navigation only by accident, exactly the failure
 * `no-widget-global-effects` reports for the History API. Ownership is never guessed from a file
 * name: the rule reports only inside the globs listed in `widgetScopes`, and with none configured
 * it is inert.
 */

import type { Rule, Scope } from 'eslint'
import type { AnyNode, MemberExpression } from '../util/ast.ts'
import { asNode, staticPropertyName } from '../util/ast.ts'
import { findVariable, resolveImportedBinding } from '../util/scope.ts'
import { matchesAnyScope } from '../util/file-scope.ts'
import {
  optionRecord,
  stringArrayOption,
  stringOption,
  widgetScopeSchema,
} from '../util/options.ts'
import { docsUrl } from '../util/docs.ts'

const NAVIGATION_METHODS: ReadonlySet<string> = new Set(['navigate', 'navigateByUrl'])

const DEFAULT_EMIT_ACCESS = '`injectWidgetEmit()`'

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow a Widget injecting Angular's Router to navigate the whole page, inside explicitly configured Widget source scopes.",
      recommended: true,
      url: docsUrl('no-widget-global-router'),
    },
    // No fix and no suggestion: the repair changes the Widget's declared contract.
    schema: widgetScopeSchema("How this Widget's render reaches `emit`, named in the repair."),
    messages: {
      navigate:
        "A Widget does not drive the URL: `{{access}}` navigates the whole page, and the host router, the owning App and every sibling MFE learn about it only by accident. Declare a navigation output in this Widget's `outputSchema` and call `emit('navigate', { to })` from {{emitAccess}}; the owning App receives the output and navigates with its own `Router`, scoped to its `BoundaryLocationStrategy`, or the shell with the host `BoundaryNavigator`.",
    },
  },

  create(context) {
    const options = optionRecord(context.options)
    const widgetScopes = stringArrayOption(options, 'widgetScopes', [])
    if (!matchesAnyScope(context.filename, widgetScopes)) return {}
    const emitAccess = stringOption(options, 'emitAccess', DEFAULT_EMIT_ACCESS)

    const { sourceCode } = context

    /** Class bodies that hold a field initialised from `inject(Router)`, by field name. */
    const routerFields = new WeakMap<AnyNode, Set<string>>()
    /** Variables (function or module scope) initialised from `inject(Router)`. */
    const routerVariables = new Set<Scope.Variable>()

    function isRouterIdentifier(node: AnyNode): boolean {
      if (node.type !== 'Identifier') return false
      const binding = resolveImportedBinding(sourceCode, node, node.name)
      return (
        binding !== null && binding.source === '@angular/router' && binding.imported === 'Router'
      )
    }

    /** `inject(Router)`, resolved through the import each name comes from, not by text. */
    function isInjectRouterCall(node: AnyNode): boolean {
      if (node.type !== 'CallExpression') return false
      const callee = node.callee
      if (callee.type !== 'Identifier') return false
      const binding = resolveImportedBinding(sourceCode, asNode(callee), callee.name)
      if (binding === null || binding.source !== '@angular/core' || binding.imported !== 'inject') {
        return false
      }
      const [firstArgument] = node.arguments
      return firstArgument !== undefined && isRouterIdentifier(asNode(firstArgument))
    }

    function enclosingClassBody(node: AnyNode): AnyNode | null {
      for (let current: AnyNode | null = node; current !== null; current = current.parent) {
        if (current.type === 'ClassBody') return current
      }
      return null
    }

    function recordField(classBody: AnyNode, name: string): void {
      const existing = routerFields.get(classBody)
      if (existing !== undefined) {
        existing.add(name)
        return
      }
      routerFields.set(classBody, new Set([name]))
    }

    function report(node: AnyNode): void {
      context.report({
        node,
        messageId: 'navigate',
        data: { access: sourceCode.getText(node), emitAccess },
      })
    }

    return {
      // `readonly router = inject(Router)` as a class field.
      PropertyDefinition(node) {
        if (node.value === null || node.value === undefined) return
        if (node.key.type !== 'Identifier' || node.computed) return
        if (!isInjectRouterCall(asNode(node.value))) return
        const classBody = enclosingClassBody(asNode(node))
        if (classBody !== null) recordField(classBody, node.key.name)
      },

      // `const router = inject(Router)`, at any function or module scope.
      VariableDeclarator(node) {
        if (node.init === null || node.init === undefined || node.id.type !== 'Identifier') return
        if (!isInjectRouterCall(asNode(node.init))) return
        const variable = findVariable(sourceCode, asNode(node.id), node.id.name)
        if (variable !== null) routerVariables.add(variable)
      },

      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression') return
        const calleeNode = asNode(callee) as MemberExpression
        const method = staticPropertyName(calleeNode)
        if (method === null || !NAVIGATION_METHODS.has(method)) return
        const receiver = callee.object

        // `inject(Router).navigate(...)`, chained without ever binding a name.
        if (isInjectRouterCall(asNode(receiver))) {
          report(calleeNode)
          return
        }

        // `router.navigate(...)`: the same scope-managed variable `inject(Router)` was bound to.
        if (receiver.type === 'Identifier') {
          const variable = findVariable(sourceCode, asNode(receiver), receiver.name)
          if (variable !== null && routerVariables.has(variable)) report(calleeNode)
          return
        }

        // `this.router.navigate(...)`: a class field this same class initialised from `inject(Router)`.
        if (receiver.type === 'MemberExpression' && receiver.object.type === 'ThisExpression') {
          const property = staticPropertyName(asNode(receiver) as MemberExpression)
          if (property === null) return
          const classBody = enclosingClassBody(asNode(node))
          if (classBody !== null && routerFields.get(classBody)?.has(property) === true) {
            report(calleeNode)
          }
        }
      },
    }
  },
}

export default rule
