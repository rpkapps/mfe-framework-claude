/** An array is a `typeof … === 'object'` too, and never what a record check means by one. */
export function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
