/**
 * `mfe/stable-definitions`.
 *
 * `createApp`, `createWidget` and `lazyWidget` produce a definition: a stable
 * identity that the host keys its registry, mount lifecycle, router integration
 * and query cache on. Calling one inside a component, a hook or any other
 * function body mints a fresh identity on every call, so the host sees a
 * different MFE each render: it unmounts the running tree, discards its state
 * and refetches. The symptom is an MFE that flickers and forgets; the cause is a
 * definition built in the wrong place.
 *
 * The callee is resolved through the scope manager, so
 * `import { createWidget as mk }` is caught under its alias, and a local
 * `function createWidget()` that shadows the import is not caught at all.
 */

import type { Rule } from 'eslint'
import type { AnyNode } from '../util/ast.ts'
import { asNode, isFunctionNode } from '../util/ast.ts'
import { resolveCalleeBinding } from '../util/scope.ts'
import { optionRecord, stringArrayOption } from '../util/options.ts'
import { docsUrl } from '../util/docs.ts'

const DEFAULT_MODULES: readonly string[] = [
  '@company/mfe-react',
  '@company/mfe-host',
  '@company/mfe-core',
]

const DEFAULT_FACTORIES: readonly string[] = ['createApp', 'createWidget', 'lazyWidget']

/**
 * The nearest enclosing node that means "this runs later, possibly many times",
 * or `null` when the call really is evaluated once, at module scope. A class
 * field initialiser and a static block count: both run per construction rather
 * than once per module.
 */
function enclosingRuntimeScope(node: AnyNode): AnyNode | null {
  let current: AnyNode = node
  for (;;) {
    const parent = current.parent
    if (parent === null || parent.type === 'Program') return null
    if (isFunctionNode(parent)) return parent
    if (parent.type === 'StaticBlock' || parent.type === 'PropertyDefinition') return parent
    current = parent
  }
}

/** The name the enclosing scope is known by, when it has one. */
function namedOwner(scope: AnyNode): string | null {
  if (
    (scope.type === 'FunctionDeclaration' || scope.type === 'FunctionExpression') &&
    scope.id !== null &&
    scope.id !== undefined
  ) {
    return scope.id.name
  }
  const parent = scope.parent
  if (parent === null) return null
  if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name
  if (parent.type === 'Property' && !parent.computed && parent.key.type === 'Identifier') {
    return parent.key.name
  }
  if (parent.type === 'MethodDefinition' && !parent.computed && parent.key.type === 'Identifier') {
    return parent.key.name
  }
  if (parent.type === 'CallExpression' && parent.callee.type === 'Identifier') {
    return `${parent.callee.name}(...)`
  }
  return null
}

/** A human description of where the offending call sits. */
function describeScope(scope: AnyNode): string {
  if (scope.type === 'StaticBlock') return 'a class static block'
  if (scope.type === 'PropertyDefinition') return 'a class field initialiser'

  const named = namedOwner(scope)
  if (named !== null) return `the body of \`${named}\``
  return scope.type === 'ArrowFunctionExpression' ? 'an arrow function' : 'a function body'
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require MFE and Widget definitions (createApp, createWidget, lazyWidget) to be created once, at module scope.',
      recommended: true,
      url: docsUrl('stable-definitions'),
    },
    // No fix and no suggestion: hoisting the call out of a closure has to move
    // whatever it captures with it, which is a refactor rather than an edit.
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          modules: {
            type: 'array',
            items: { type: 'string' },
            description: 'Module specifiers whose definition factories are guarded.',
          },
          factories: {
            type: 'array',
            items: { type: 'string' },
            description: 'Exported factory names that have to be called at module scope.',
          },
        },
      },
    ],
    messages: {
      notModuleScope:
        '`{{local}}` (`{{name}}` from {{source}}) has to be called once, at module scope. Calling it in {{where}} mints a new definition identity on every call, so the host treats it as a different MFE: it unmounts the running instance, throws away its state and refetches its data. Move the `{{name}}(...)` call to the top level of this module and reference the resulting definition here.',
    },
  },

  create(context) {
    const options = optionRecord(context.options)
    const modules = new Set(stringArrayOption(options, 'modules', DEFAULT_MODULES))
    const factories = new Set(stringArrayOption(options, 'factories', DEFAULT_FACTORIES))
    const { sourceCode } = context

    return {
      CallExpression(node) {
        const binding = resolveCalleeBinding(sourceCode, asNode(node.callee))
        if (binding === null) return
        if (!modules.has(binding.source) || !factories.has(binding.imported)) return

        const scope = enclosingRuntimeScope(node)
        if (scope === null) return

        context.report({
          node,
          messageId: 'notModuleScope',
          data: {
            local: sourceCode.getText(asNode(node.callee)),
            name: binding.imported,
            source: binding.source,
            where: describeScope(scope),
          },
        })
      },
    }
  },
}

export default rule
