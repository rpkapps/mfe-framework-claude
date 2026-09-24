/**
 * This package's own development flag. `DEV` from `@company/mfe-core` reads the same, but core is
 * a shared module: an import of it is a lookup in the share scope at run time, which no minifier
 * can see through, so every statement it guards would ship to production. A flag local to the
 * package is inlined with the code it guards and folds away there.
 *
 * It is unguarded on purpose. `typeof process !== 'undefined' && …` leaves the `typeof` test
 * behind after substitution, and Rspack's minifier keeps it and every guarded statement with it.
 * Nothing is lost by requiring the substitution: Rsbuild always makes it, webpack makes it from
 * `mode`, which an Angular container's build always sets, and a Node test runner has `process`.
 */
export const DEV: boolean = process.env['NODE_ENV'] !== 'production'
