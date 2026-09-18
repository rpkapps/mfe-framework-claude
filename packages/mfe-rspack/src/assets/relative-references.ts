/**
 * An imported asset and `new URL('./x.svg', import.meta.url).href` resolve
 * against the deployed container because the bundler rewrites them. A bare
 * relative path in a string resolves against the shell document instead, so it
 * works in a dev server and 404s once the container is deployed elsewhere.
 */

import { createBuildError } from '../diagnostics.ts'
import { parseSourceFile, positionOf, ts, walk } from '../discovery/ts-ast.ts'

/** Extensions that mean "this string names an asset", not "this is a route". */
const ASSET_EXTENSIONS = [
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'mp3',
  'mp4',
  'webm',
  'pdf',
  'css',
  'wasm',
]

const RELATIVE_ASSET_PATTERN = new RegExp(
  `^\\.{1,2}/[^\\s'"\`]*\\.(?:${ASSET_EXTENSIONS.join('|')})$`,
  'i',
)

/**
 * Reports bare relative asset references in one module.
 *
 * Import specifiers and the first argument of `new URL(…, import.meta.url)` are
 * both container-aware already, so neither is reported.
 */
export function findNonContainerAwareAssetReferences(
  file: string,
  source?: string,
): readonly Error[] {
  const sourceFile = parseSourceFile(file, source)
  const errors: Error[] = []

  walk(sourceFile, node => {
    if (!ts.isStringLiteralLike(node)) return
    if (ts.isTemplateExpression(node)) return

    const text = node.text
    if (!RELATIVE_ASSET_PATTERN.test(text)) return
    if (isContainerAware(node)) return

    const { line, column } = positionOf(sourceFile, node)
    errors.push(
      createBuildError({
        file,
        line,
        column,
        operation: 'resolve an asset reference',
        expected: 'a reference the build can rewrite to the deployed container',
        observed: `the bare relative path '${text}'`,
        declaredBy: 'Container-relative asset resolution',
        repair: `Import it (\`import assetUrl from '${text}'\`) or write \`new URL('${text}', import.meta.url).href\`. Both resolve against the container's own deployed location; a bare string resolves against the shell document instead, which only agrees with the container while you are running a dev server.`,
      }),
    )
  })

  return errors
}

/**
 * True when the literal is already in a position the bundler rewrites: an
 * import or export specifier, a dynamic `import()`, or `new URL(…,
 * import.meta.url)`.
 */
function isContainerAware(node: ts.StringLiteralLike): boolean {
  const parent = node.parent
  if (parent === undefined) return false

  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true
  if (ts.isImportTypeNode(parent)) return true
  if (ts.isExternalModuleReference(parent)) return true

  if (ts.isCallExpression(parent)) {
    if (parent.expression.kind === ts.SyntaxKind.ImportKeyword) return true
    if (ts.isIdentifier(parent.expression) && parent.expression.text === 'require') return true
  }

  if (ts.isNewExpression(parent)) {
    const callee = parent.expression
    if (ts.isIdentifier(callee) && callee.text === 'URL') {
      const second = parent.arguments?.[1]
      if (
        second !== undefined &&
        ts.isPropertyAccessExpression(second) &&
        second.name.text === 'url' &&
        ts.isMetaProperty(second.expression)
      ) {
        return true
      }
    }
  }

  return false
}
