/**
 * The development flag every framework package guards its developer-only work
 * with.
 *
 * It is a module constant rather than a runtime check so a bundler folds it to
 * `false` and drops the guarded statement whole — the branch, the object
 * literal it builds and every string inside it. A runtime `if` would leave all
 * of that in the production bundle to be skipped at speed, which is the thing
 * worth avoiding: the diagnostics the framework writes for a developer are long
 * on purpose.
 *
 * `process.env.NODE_ENV` is spelled out literally because that exact member
 * expression is what a bundler substitutes; reaching it through
 * `globalThis.process?.env?.[…]` reads as more careful and silently defeats the
 * substitution, leaving the guard — and everything it guards — in the bundle.
 * The `typeof` check is what keeps the module evaluable in a browser build that
 * defined nothing, and it folds away with the rest.
 *
 * Guard *statements* with it, never a value a caller still has to build:
 * `if (DEV) diagnose({ … })` strips, `diagnose(DEV ? { … } : undefined)` does
 * not strip as reliably and reads worse.
 */
export const DEV: boolean =
  typeof process !== 'undefined' && process.env['NODE_ENV'] !== 'production'
