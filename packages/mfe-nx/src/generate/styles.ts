/**
 * An Angular container's own global stylesheet reaches the page through the generated one. The
 * builder's `styles` option would put it in a page-level bundle a remote never loads; imported
 * here, it ships with every exposed entry and is compiled and scoped with the utilities.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { generatedPath, relativeSpecifier, type GenerateContext } from '@company/mfe-build'

/** Relative to the container root; the generator scaffolds it and the author may delete it. */
export const GLOBAL_STYLESHEET = 'src/styles.css'

/** Where the neutral build writes the stylesheet it generates for a container. */
export function containerStylesheetPath(generatedDir: string): string {
  return generatedPath(generatedDir, 'styles.css')
}

/** The lines the generated stylesheet adds after the Tailwind imports. */
export function globalStylesheetImports(context: GenerateContext): readonly string[] {
  const stylesheet = join(context.options.containerRoot, GLOBAL_STYLESHEET)
  if (!existsSync(stylesheet)) return []

  const generated = containerStylesheetPath(context.options.generatedDir)
  return [`@import ${JSON.stringify(relativeSpecifier(generated, stylesheet))};`]
}
