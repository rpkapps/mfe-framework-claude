/**
 * `context.options` is untyped by construction and the repository's TypeScript
 * baseline forbids unchecked indexing, so rules read options through these
 * narrow helpers rather than asserting a shape.
 */

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
