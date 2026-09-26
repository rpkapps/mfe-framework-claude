/**
 * The framework packages publish compiled output, and each names its TypeScript source under the
 * `mfe-source` export condition as well. The bundlers, the tests and the type checker in this
 * repository resolve with that condition, so a change to a package reaches the shell, the examples
 * and the suites without a build; a published consumer never sets it and gets `dist/`.
 *
 * Two things still read `dist/`. Node never sets the condition, so the build tooling a config or a
 * CLI loads natively, `@company/mfe-rspack` and the `@company/mfe-build` and `@company/mfe-core`
 * behind it, is built by the root scripts that start it. And examples/fieldwork, an Angular container in an Nx workspace of its own, is
 * built the way a consumer builds it, because the Angular compiler emits nothing for a file reached
 * through `node_modules`; its scripts build what it depends on. Both go through `build:stale`,
 * which leaves a current `dist/` alone (require-built.mjs), so one never rewrites a `dist/` while
 * the other is reading it; the root scripts bring all of them up to date before anything runs.
 */

/** Not `source`, which other packages use too, such as react-aria for files it never publishes. */
export const SOURCE_CONDITION = 'mfe-source'

/** Vite's own defaults with the condition added, because setting `conditions` replaces them. */
export const sourceResolveForTests = {
  conditions: [SOURCE_CONDITION, 'module', 'browser', 'development|production'],
}

/** The same for a Vitest project in the node environment, which resolves as Vite's SSR does. */
export const sourceSsrForTests = {
  resolve: { conditions: [SOURCE_CONDITION, 'module', 'node', 'development|production'] },
}

/** Rspack's `...` keeps its own defaults, to which the condition is added. */
export const sourceConditionNames = ['...', SOURCE_CONDITION]
