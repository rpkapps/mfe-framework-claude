/**
 * A container ships the CSS for the classes it uses, because Tailwind emits a utility only for
 * a class it has seen; the shell owns the document, so no preflight and no variables here (§17).
 */

import { join } from 'node:path'

import { banner, generatedPath, joinBlocks, relativeSpecifier, type GeneratedFile } from './emit.ts'
import type { GenerateContext } from './modules.ts'

export function stylesheetPath(context: GenerateContext): string {
  return generatedPath(context.options.generatedDir, 'styles.css')
}

/** How the generated module `fromFile` imports the stylesheet, query included. */
export function stylesheetRequest(context: GenerateContext, fromFile: string): string {
  const query = context.profile.stylesheet.query ?? ''
  return `${relativeSpecifier(fromFile, stylesheetPath(context))}${query}`
}

export function stylesheetFile(context: GenerateContext): GeneratedFile {
  const file = stylesheetPath(context)
  const { stylesheet } = context.profile
  const imports = stylesheet.imports?.(context) ?? []

  return {
    path: file,
    contents: joinBlocks([
      banner(context.profile.generator),
      [
        '/*',
        ' * Tailwind, split: the theme and the utilities, and deliberately not',
        ' * `@import "tailwindcss"`, which would also bring preflight. The reset',
        ' * belongs to whoever owns the document, and that is the shell — along',
        ' * with the fonts, which reach this container through --font-sans and',
        ' * --font-mono like any other inherited value.',
        ' */',
        '@layer theme, base, components, utilities;',
        '@import "tailwindcss/theme.css" layer(theme);',
        '@import "tailwindcss/utilities.css" layer(utilities);',
        ...(imports.length === 0 ? [] : ['', ...imports]),
      ].join('\n'),
      [
        '/*',
        ' * What Tailwind scans. Splitting the imports above turns automatic source',
        ' * detection off, so every directory holding classes this container renders',
        ' * has to be named here — the library scans its own. The one entry',
        " * below covers the whole of this container's `src/`; nothing under",
        ' * node_modules needs scanning.',
        ' */',
        `@source "${relativeSpecifier(file, join(context.options.containerRoot, 'src'))}/${stylesheet.sources}";`,
      ].join('\n'),
    ]),
  }
}

/** TypeScript only has to know the module exists; the bundler injects the stylesheet. */
export function cssModuleTypes(context: GenerateContext): GeneratedFile {
  const { query } = context.profile.stylesheet
  const declarations = ["declare module '*.css'"]
  if (query !== undefined) declarations.push(`declare module '*${query}'`)

  return {
    path: generatedPath(context.options.generatedDir, 'css.d.ts'),
    contents: joinBlocks([banner(context.profile.generator), declarations.join('\n')]),
  }
}
