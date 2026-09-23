/**
 * A container ships the CSS for the classes it uses, because Tailwind emits a utility only for
 * a class it has seen; the shell owns the document, so no preflight and no variables here (§17).
 */

import { join } from 'node:path'

import { banner, generatedPath, joinBlocks, relativeSpecifier, type GeneratedFile } from './emit.ts'
import type { GenerateContext } from './modules.ts'

const DESIGN_SYSTEM = '@tecton/react'

export function stylesheetPath(context: GenerateContext): string {
  return generatedPath(context.options.generatedDir, 'styles.css')
}

/** Where the component that wraps a mounted definition's tree lives. */
export function styleRootPath(context: GenerateContext): string {
  return generatedPath(context.options.generatedDir, 'entries', 'style-root.tsx')
}

export function usesDesignSystem(context: GenerateContext): boolean {
  return DESIGN_SYSTEM in context.options.dependencies
}

export function stylesheetFile(context: GenerateContext): GeneratedFile {
  const file = stylesheetPath(context)

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
        ' * has to be named here — the library scans its own. The one entry',
        " * below covers the whole of this container's `src/`; nothing under",
        ' * node_modules needs scanning.',
        ' */',
        `@source "${relativeSpecifier(file, join(context.options.containerRoot, 'src'))}/**/*.{ts,tsx}";`,
      ].join('\n'),
    ]),
  }
}

/**
 * It has to be this container's own copy of the library, because the components it renders read
 * their portal target from that copy's React context (§17).
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

/** TypeScript only has to know the module exists; the bundler injects the stylesheet. */
export function cssModuleTypes(context: GenerateContext): GeneratedFile {
  return {
    path: generatedPath(context.options.generatedDir, 'css.d.ts'),
    contents: joinBlocks([banner(), "declare module '*.css'"]),
  }
}
