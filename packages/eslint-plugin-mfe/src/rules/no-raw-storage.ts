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
 * The repair names the adapter's own component-state and imperative-storage APIs, so a container
 * written against a different adapter needs its own names here. These are the React defaults,
 * unchanged from before this option existed.
 */
const DEFAULT_STORED_STATE_HOOK = 'useStoredState()'
const DEFAULT_STORAGE_HOOK = 'useMfeStorage()'
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
    hasSuggestions: true,
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
          storageAccessor: {
            type: 'string',
            description:
              'Identifier the suggestion rewrites to, that is, the name the project binds the imperative storage hook to. Defaults to "storage".',
          },
          storedStateHook: {
            type: 'string',
            description: "The adapter's component-state storage hook, named in the repair.",
          },
          storageHook: {
            type: 'string',
            description: "The adapter's imperative storage hook, named in the repair.",
          },
          adapterModule: {
            type: 'string',
            description: '`storedStateHook` and `storageHook` both come from this module.',
          },
        },
      },
    ],
    messages: {
      rawStorage:
        "`{{access}}` bypasses the MFE storage boundary: the key is not namespaced, so another MFE in this origin can read or overwrite it, it carries no version to migrate a changed shape from, and a quota failure escapes as an unhandled exception. Use `{{storedStateHook}}` for component state or `{{storageHook}}` for imperative access, both from {{adapterModule}}. The storage adapter and a documented shell override bootstrap opt out through this rule's `allowedScopes` option.",
      useBoundary:
        'Read and write through the MFE storage boundary: replace `{{access}}` with `{{accessor}}` from `const {{accessor}} = {{storageHook}}`.',
    },
  },

  create(context) {
    const options = optionRecord(context.options)
    const allowedScopes = stringArrayOption(options, 'allowedScopes', [])
    const objects = new Set(stringArrayOption(options, 'objects', DEFAULT_OBJECTS))
    const accessor = stringOption(options, 'storageAccessor', 'storage')
    const storedStateHook = stringOption(options, 'storedStateHook', DEFAULT_STORED_STATE_HOOK)
    const storageHook = stringOption(options, 'storageHook', DEFAULT_STORAGE_HOOK)
    const adapterModule = stringOption(options, 'adapterModule', DEFAULT_ADAPTER_MODULE)

    if (matchesAnyScope(context.filename, allowedScopes)) return {}

    const { sourceCode } = context

    function report(node: AnyNode): void {
      const access = sourceCode.getText(node)
      context.report({
        node,
        messageId: 'rawStorage',
        data: { access, storedStateHook, storageHook, adapterModule },
        suggest: [
          {
            messageId: 'useBoundary',
            data: { access, accessor, storageHook },
            // A suggestion rather than a fix: it only compiles once the file binds the storage hook.
            fix: fixer => fixer.replaceText(node, accessor),
          },
        ],
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
