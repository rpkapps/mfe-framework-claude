/**
 * Nx loads `app`, `widget` and `generate` through `generators.json` and `executors.json`, and the
 * Angular builder loads the build integration from `@company/mfe-nx/webpack`, not from this
 * module — but every package's public surface goes through `src/index.ts`, and a consumer that
 * wants to call a generator programmatically (from its own script, or from a test) needs somewhere
 * to import it from.
 */

export { default as appGenerator } from './generators/app/generator.ts'
export { default as widgetGenerator } from './generators/widget/generator.ts'

export type { MfeGeneratorSchema, MfeTemplate } from './generators/shared/schema.ts'
export type { NormalizedSchema } from './generators/shared/normalize.ts'
export { SUPPORTED_NX_MAJORS } from './generators/shared/versions.ts'

export { default as generateExecutor } from './executors/generate/executor.ts'
export type { GenerateExecutorOptions } from './executors/generate/executor.ts'
