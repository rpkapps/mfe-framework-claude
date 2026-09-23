/** `context.options` is untyped, so rules read it here rather than asserting a shape. */

import type { Rule } from 'eslint'

/**
 * The `widgetScopes`/`emitAccess` schema both Widget-boundary rules (`no-widget-global-effects`
 * and `no-widget-global-router`) share: Widget ownership is declared through globs, never guessed
 * from a file name, so the rule stays inert until a repository configures them.
 */
export function widgetScopeSchema(emitAccessDescription: string): Rule.RuleMetaData['schema'] {
  return [
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
        emitAccess: {
          type: 'string',
          description: emitAccessDescription,
        },
      },
    },
  ]
}

export function optionRecord(options: readonly unknown[]): Record<string, unknown> {
  const first = options[0]
  if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
    return first as Record<string, unknown>
  }
  return {}
}

export function stringArrayOption(
  record: Record<string, unknown>,
  key: string,
  fallback: readonly string[],
): readonly string[] {
  const value = record[key]
  if (!Array.isArray(value)) return fallback
  return value.filter((entry): entry is string => typeof entry === 'string')
}

export function stringOption(
  record: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}
