/**
 * An Angular container's own global stylesheet reaches the page through the generated one. The
 * builder's `styles` option would put it in a page-level bundle a remote never loads; imported
 * here, it ships with every exposed entry and is compiled and scoped with the utilities.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { relativeSpecifier, stylesheetPath, type GenerateContext } from '@company/mfe-build'

/** Relative to the container root; the generator scaffolds it and the author may delete it. */
export const GLOBAL_STYLESHEET = 'src/styles.css'

/**
 * Angular compiles a `.css` request only when it carries one of its own queries; this one selects
 * the global-style loaders, which extract the stylesheet rather than inlining it as a string.
 */
export const GLOBAL_STYLE_QUERY = '?ngGlobalStyle'

/** The lines the generated stylesheet adds for this Angular container's global CSS. */
export function globalStylesheetImports(context: GenerateContext): readonly string[] {
  const stylesheet = join(context.options.containerRoot, GLOBAL_STYLESHEET)
  if (!existsSync(stylesheet)) return []

  return [`@import ${JSON.stringify(relativeSpecifier(stylesheetPath(context), stylesheet))};`]
}
