/**
 * `mfe/no-raw-storage`.
 *
 * `localStorage` and `sessionStorage` are one flat, unversioned key space shared
 * by the shell and by every MFE in the origin. Written directly, keys collide
 * across MFEs, they cannot be namespaced per deployment, the shell cannot clear
 * or migrate them on sign-out, and a quota error surfaces as an unhandled
 * exception in whichever MFE happened to write last. The framework storage
 * boundary owns the prefix, the serialisation envelope and the failure mode.
 *
 * The framework's own storage adapter, and a shell bootstrap that deliberately
 * overrides storage, opt out through the `allowedScopes` option: ownership is
 * declared in configuration, never inferred from a file name.
 */

import type { Rule } from 'eslint'
import type { AnyNode, Identifier } from '../util/ast.ts'
import { asNode, isValueReference, staticPropertyName, unwrapExpression } from '../util/ast.ts'
import { isGlobalBinding, isGlobalObjectName } from '../util/scope.ts'
import { matchesAnyScope } from '../util/file-scope.ts'
import { optionRecord, stringArrayOption, stringOption } from '../util/options.ts'
import { docsUrl } from '../util/docs.ts'

const DEFAULT_OBJECTS: readonly string[] = ['localStorage', 'sessionStorage']

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
              'Identifier the suggestion rewrites to, that is, the name the project binds `useMfeStorage()` to. Defaults to "storage".',
          },
        },
      },
    ],
    messages: {
      rawStorage:
        "`{{access}}` bypasses the MFE storage boundary: the key is not namespaced, so another MFE in this origin can read or overwrite it, the shell cannot clear it on sign-out, and a quota failure escapes as an unhandled exception. Use `useStoredState()` for component state or `useMfeStorage()` for imperative access, both from @company/mfe-react. The storage adapter and a documented shell override bootstrap opt out through this rule's `allowedScopes` option.",
      useBoundary:
        'Read and write through the MFE storage boundary: replace `{{access}}` with `{{accessor}}` from `const {{accessor}} = useMfeStorage()`.',
    },
  },

  create(context) {
    const options = optionRecord(context.options)
    const allowedScopes = stringArrayOption(options, 'allowedScopes', [])
    const objects = new Set(stringArrayOption(options, 'objects', DEFAULT_OBJECTS))
    const accessor = stringOption(options, 'storageAccessor', 'storage')

    if (matchesAnyScope(context.filename, allowedScopes)) return {}

    const { sourceCode } = context

    function report(node: AnyNode): void {
      const access = sourceCode.getText(node)
      context.report({
        node,
        messageId: 'rawStorage',
        data: { access },
        suggest: [
          {
            messageId: 'useBoundary',
            data: { access, accessor },
            // A suggestion rather than a fix: the edit is one local
            // replacement, but it only compiles once the file binds
            // `useMfeStorage()`, so a human has to accept it.
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
        // `window.localStorage`, `globalThis.sessionStorage`, `self.localStorage`.
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
