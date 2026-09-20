/**
 * The container's own stylesheet, and the design-system root its overlays hang
 * from.
 *
 * A container ships the CSS for the classes it uses, because Tailwind emits a
 * utility only when it has seen the class in a file it scanned, and a shell on
 * its own release train has not seen a container's source. What it must not
 * ship is a second copy of the page: no preflight, no font faces and not one
 * variable declaration, because the shell owns the document and its theme
 * values inherit into the mounted subtree like any custom property.
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { banner, generatedPath, joinBlocks, relativeSpecifier, type GeneratedFile } from './emit.ts'
import type { GenerateContext } from './modules.ts'

/** The design system, and the block compositions published beside it. */
const DESIGN_SYSTEM = '@tecton/react'
const DESIGN_SYSTEM_BLOCKS = '@tecton/blocks'

/** Where the generated stylesheet lives, next to the generated modules. */
export function stylesheetPath(context: GenerateContext): string {
  return generatedPath(context.options.generatedDir, 'styles.css')
}

/** Where the component that wraps a mounted definition's tree lives. */
export function styleRootPath(context: GenerateContext): string {
  return generatedPath(context.options.generatedDir, 'entries', 'style-root.tsx')
}

/** Whether this container renders the design system's components at all. */
export function usesDesignSystem(context: GenerateContext): boolean {
  return DESIGN_SYSTEM in context.options.dependencies
}

export function stylesheetFile(context: GenerateContext): GeneratedFile {
  const file = stylesheetPath(context)
  const blocks = blockSources(context)

  return {
    path: file,
    contents: joinBlocks([
      banner(),
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
        ...(usesDesignSystem(context)
          ? [
              '',
              '/*',
              " * The design system's scoped entry: utilities only, no variables, so",
              " * nothing here redeclares what the shell's :root already says.",
              ' */',
              `@import "${DESIGN_SYSTEM}/styles/scoped.css";`,
            ]
          : []),
      ].join('\n'),
      [
        '/*',
        ' * What Tailwind scans. Splitting the imports above turns automatic source',
        ' * detection off, so every directory holding classes this container renders',
        ' * has to be named here — the library scans its own.',
        ' */',
        `@source "${relativeSpecifier(file, join(context.options.containerRoot, 'src'))}/**/*.{ts,tsx}";`,
        ...(blocks === null
          ? []
          : [
              '',
              '/*',
              ' * The blocks are published as unbuilt TSX and installed like any other',
              ' * dependency, and nothing under node_modules is scanned by default, so a',
              ' * class only a block uses would otherwise have no CSS at all.',
              ' */',
              `@source "${blocks}/**/*.{ts,tsx}";`,
            ]),
      ].join('\n'),
    ]),
  }
}

/**
 * Where the blocks' sources sit, relative to the generated stylesheet, or null
 * when this container does not depend on them.
 */
function blockSources(context: GenerateContext): string | null {
  if (!(DESIGN_SYSTEM_BLOCKS in context.options.dependencies)) return null

  const root = packageRoot(context.options.containerRoot, DESIGN_SYSTEM_BLOCKS)
  return root === null ? null : relativeSpecifier(stylesheetPath(context), join(root, 'src'))
}

/**
 * Resolved from the container rather than from this package, so a container
 * that installs its own copy gets that one.
 *
 * The manifest is asked for first and the package entry second: a package whose
 * `exports` map does not publish its own package.json cannot be resolved the
 * first way, and the design system's blocks are published exactly like that.
 */
function packageRoot(containerRoot: string, name: string): string | null {
  const require = createRequire(join(containerRoot, 'package.json'))

  try {
    return dirname(require.resolve(`${name}/package.json`))
  } catch {
    // Not installed, or not exported. The entry below decides which.
  }

  let directory: string
  try {
    directory = dirname(require.resolve(name))
  } catch {
    // A dependency the container declares but has not installed. Whatever
    // imports it reports that itself, in terms the developer can act on.
    return null
  }

  while (!existsSync(join(directory, 'package.json'))) {
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
  return directory
}

/**
 * The design system's root, rendered by the container's own bundle.
 *
 * It has to be this container's copy of the library: the components it renders
 * read their portal target from that copy's React context, and a shell running
 * another version holds a different module instance with a different context.
 * So the build generates the component and attaches it to the definition, and
 * the mount renders it inside the scope root.
 */
export function styleRootModule(context: GenerateContext): GeneratedFile | null {
  if (!usesDesignSystem(context)) return null

  return {
    path: styleRootPath(context),
    contents: joinBlocks([
      banner(),
      [
        `import { ThemeRoot } from '${DESIGN_SYSTEM}/tecton/theme-root'`,
        "import { useLayoutEffect, type ReactNode } from 'react'",
      ].join('\n'),
      [
        '// Out of layout, exactly as the scope root above it is, so the App or',
        '// Widget stays the direct child of whatever the host laid out.',
        "const LAYOUT_NEUTRAL = { display: 'contents' } as const",
      ].join('\n'),
      [
        '/**',
        " * `overlayContainer` is the mount's body-level overlay root, and every",
        ' * overlay the design system raises — dialog, sheet, popover, tooltip,',
        ' * select, combobox, menu, drawer — portals into it. That is what keeps an',
        " * overlay inside this container's @scope: the element already carries the",
        " * mount's data-mfe-scope. The marker set below is the other half of it —",
        ' * the library hangs its base border and outline colours on the root and its',
        ' * descendants, and the overlay contents are descendants of this element',
        ' * rather than of the root inside the page.',
        ' */',
        'export function StyleRoot({',
        '  overlayContainer,',
        '  children,',
        '}: {',
        '  readonly overlayContainer: HTMLElement',
        '  readonly children: ReactNode',
        '}): ReactNode {',
        '  useLayoutEffect(() => {',
        "    overlayContainer.setAttribute('data-tecton-root', '')",
        '    return () => {',
        "      overlayContainer.removeAttribute('data-tecton-root')",
        '    }',
        '  }, [overlayContainer])',
        '',
        '  return (',
        '    <ThemeRoot overlayContainer={overlayContainer} style={LAYOUT_NEUTRAL}>',
        '      {children}',
        '    </ThemeRoot>',
        '  )',
        '}',
      ].join('\n'),
    ]),
  }
}

/**
 * A bundler turns a CSS import into a side effect that injects the stylesheet.
 * TypeScript only has to know the module exists, and this is the whole of what
 * it needs to be told.
 */
export function cssModuleTypes(context: GenerateContext): GeneratedFile {
  return {
    path: generatedPath(context.options.generatedDir, 'css.d.ts'),
    contents: joinBlocks([banner(), "declare module '*.css'"]),
  }
}
