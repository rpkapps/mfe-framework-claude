/**
 * The development flag every framework package guards its developer-only work with.
 * `process.env.NODE_ENV` is spelled out literally so a bundler substitutes it and folds
 * the guarded statement away; reading it through `globalThis.process?.env` silently
 * defeats the substitution.
 */
export const DEV: boolean =
  typeof process !== 'undefined' && process.env['NODE_ENV'] !== 'production'
