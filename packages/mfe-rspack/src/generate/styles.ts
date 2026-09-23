/**
 * What the design system adds to a React container's generated output: its scoped stylesheet
 * entry, and a root around each mounted tree so its overlays stay inside the container (§17).
 */

import {
  banner,
  exportedName,
  generatedPath,
  joinBlocks,
  quote,
  relativeSpecifier,
  type ExposedDefinition,
  type GenerateContext,
  type GeneratedFile,
} from '@company/mfe-build'

const DESIGN_SYSTEM = '@tecton/react'

/** Where the component that wraps a mounted definition's tree lives. */
export function styleRootPath(context: GenerateContext): string {
  return generatedPath(context.options.generatedDir, 'entries', 'style-root.tsx')
}

export function usesDesignSystem(context: GenerateContext): boolean {
  return DESIGN_SYSTEM in context.options.dependencies
}

/** Added to the container stylesheet after Tailwind's own imports. */
export function designSystemStylesheetImports(context: GenerateContext): readonly string[] {
  if (!usesDesignSystem(context)) return []

  return [
    '/*',
    " * The design system's scoped entry: utilities only, no variables, so",
    " * nothing here redeclares what the shell's :root already says.",
    ' */',
    `@import "${DESIGN_SYSTEM}/styles/scoped.css";`,
  ]
}

/** Without a design system there is nothing to wrap the rendered tree in. */
export function exposeWithStyleRoot(
  context: GenerateContext,
  { file, definition, authored }: ExposedDefinition,
): readonly string[] | null {
  if (!usesDesignSystem(context)) return null

  return [
    "import { withStyleRoot } from '@company/mfe-react'",
    [
      definition.isDefaultExport
        ? `import authored from ${quote(authored)}`
        : `import { ${exportedName(definition)} as authored } from ${quote(authored)}`,
      `import { StyleRoot } from ${quote(relativeSpecifier(file, styleRootPath(context)))}`,
    ].join('\n'),
    [
      '// The mount renders the style root inside the scope root and hands it',
      "// this mount's overlay container, so the design system's overlays portal",
      '// into the container scope instead of a bare document body.',
      'export const definition = withStyleRoot(authored, StyleRoot)',
    ].join('\n'),
  ]
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
      banner(context.profile.generator),
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
