/**
 * Web Storage is one flat key space shared by the shell and every MFE in the origin, so keys
 * collide, nothing versions them for a migration and a quota error escapes. An `allowedScopes`
 * entry that cannot justify itself is a missing primitive, not an exception (§24).
 */

import type { Rule } from 'eslint'
import type { AnyNode, Identifier } from '../util/ast.ts'
import { asNode, isValueReference, staticPropertyName, unwrapExpression } from '../util/ast.ts'
import { isGlobalBinding, isGlobalObjectName } from '../util/scope.ts'
import { matchesAnyScope } from '../util/file-scope.ts'
import { optionRecord, stringArrayOption, stringOption } from '../util/options.ts'
import { docsUrl } from '../util/docs.ts'

const DEFAULT_OBJECTS: readonly string[] = ['localStorage', 'sessionStorage']

/**
 * The repair names the adapter's own stored-state API, so a container written against a different
 * adapter needs its own name here. These are the React defaults.
 */
const DEFAULT_STORED_STATE_HOOK = 'useStoredState()'
const DEFAULT_ADAPTER_MODULE = '@company/mfe-react'

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct Web Storage access; go through the framework storage boundary instead.',
      recommended: true,
      url: docsUrl('no-raw-storage'),
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowedScopes: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Globs for files allowed to touch Web Storage directly: the framework storage adapter, and a documented shell override bootstrap.',
          },
          objects: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Global storage objects to guard. Defaults to localStorage and sessionStorage.',
          },
          storedStateHook: {
            type: 'string',
            description: "The adapter's stored-state hook, named in the repair.",
          },
          adapterModule: {
            type: 'string',
            description: '`storedStateHook` comes from this module.',
          },
        },
      },
    ],
    messages: {
      rawStorage:
        "`{{access}}` bypasses the MFE storage boundary: the key is not namespaced, so another MFE in this origin can read or overwrite it, it carries no version to migrate a changed shape from, and a quota failure escapes as an unhandled exception. Declare the value with `storedKey` and read and write it through `{{storedStateHook}}` from {{adapterModule}}. The storage adapter and a documented shell override bootstrap opt out through this rule's `allowedScopes` option.",
    },
  },

  create(context) {
    const options = optionRecord(context.options)
    const allowedScopes = stringArrayOption(options, 'allowedScopes', [])
    const objects = new Set(stringArrayOption(options, 'objects', DEFAULT_OBJECTS))
    const storedStateHook = stringOption(options, 'storedStateHook', DEFAULT_STORED_STATE_HOOK)
    const adapterModule = stringOption(options, 'adapterModule', DEFAULT_ADAPTER_MODULE)

    if (matchesAnyScope(context.filename, allowedScopes)) return {}

    const { sourceCode } = context

    function report(node: AnyNode): void {
      const access = sourceCode.getText(node)
      context.report({
        node,
        messageId: 'rawStorage',
        data: { access, storedStateHook, adapterModule },
      })
    }

    return {
      Identifier(node: Identifier) {
        if (!objects.has(node.name)) return
        if (!isValueReference(node)) return
        if (!isGlobalBinding(sourceCode, node, node.name)) return
        report(node)
      },

      MemberExpression(node) {
        const property = staticPropertyName(node)
        if (property === null || !objects.has(property)) return
        const object = unwrapExpression(asNode(node.object))
        if (object.type !== 'Identifier') return
        if (!isGlobalObjectName(sourceCode, node, object.name)) return
        report(node)
      },
    }
  },
}

export default rule
