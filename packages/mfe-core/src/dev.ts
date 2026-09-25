/**
 * The development flag for code bundled together with this module. `process.env.NODE_ENV` is
 * spelled out literally so a bundler substitutes it and folds the guarded statement away; reading
 * it through `globalThis.process?.env` silently defeats the substitution.
 *
 * It folds only where this module is inlined, though. Core is a shared module in every container,
 * so another package importing `DEV` from it reads a binding resolved through the share scope at
 * run time, and whatever that guards ships to production. The framework packages keep a copy of
 * their own for that reason (`src/dev.ts` in each).
 */
export const DEV: boolean =
  typeof process !== 'undefined' && process.env['NODE_ENV'] !== 'production'
