/**
 * `@company/mfe-nx/webpack`: what a container's `customWebpackConfig` imports. CommonJS like the
 * rest of this package, because the Angular builder loads that file with `require()`; the build
 * layer behind `withMfe()` is only loaded once the builder calls it.
 */

export { withMfe } from './with-mfe.ts'
export type { BuilderTarget, CustomWebpackConfig } from './with-mfe.ts'
export type { MfeWebpackPluginSettings } from './plugin.ts'
export type { MfeAngularOptions } from '../options.ts'
