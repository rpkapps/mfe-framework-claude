/** Nx loads `app` and `widget` through `generators.json`, not through this module — but every
 * package's public surface goes through `src/index.ts`, and a consumer that wants to call a
 * generator programmatically (from its own script, or from a test) needs somewhere to import it
 * from. */

export { default as appGenerator } from './generators/app/generator.ts'
export { default as widgetGenerator } from './generators/widget/generator.ts'

export type { MfeGeneratorSchema, MfeTemplate } from './generators/shared/schema.ts'
export type { NormalizedSchema } from './generators/shared/normalize.ts'
export { angularRspackVersionFor } from './generators/shared/versions.ts'
