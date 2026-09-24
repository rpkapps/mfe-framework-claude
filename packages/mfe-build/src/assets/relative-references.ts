/** A bare relative path in a string resolves against the shell document, not the container. */

import { createBuildError } from '../diagnostics.ts'
import { standaloneSources, type ContainerSources } from '../discovery/sources.ts'
import {
  calleeName,
  importedLocals,
  positionOf,
  propertyName,
  ts,
  walk,
} from '../discovery/ts-ast.ts'

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

const RELATIVE_ASSET = `\\.{1,2}/[^\\s'"\`]*\\.(?:${ASSET_EXTENSIONS.join('|')})`

const RELATIVE_ASSET_PATTERN = new RegExp(`^${RELATIVE_ASSET}$`, 'i')

/** Anywhere in a file: a literal the pattern above accepts is written out in the file's text. */
const RELATIVE_ASSET_MENTION = new RegExp(RELATIVE_ASSET, 'i')

/** Import specifiers and `new URL(…, import.meta.url)` are container-aware and not reported. */
export function findNonContainerAwareAssetReferences(
  file: string,
  sources: ContainerSources = standaloneSources(),
): readonly Error[] {
  // Most modules name no asset at all, and parsing is what the scan costs.
  if (!RELATIVE_ASSET_MENTION.test(sources.read(file))) return []

  const sourceFile = sources.parse(file)
  const angularComponents = importedLocals(sourceFile, ['@angular/core'], ['Component'], {
    namespaces: true,
  })
  const errors: Error[] = []

  walk(sourceFile, node => {
    if (!ts.isStringLiteralLike(node)) return
    if (ts.isTemplateExpression(node)) return

    const text = node.text
    if (!RELATIVE_ASSET_PATTERN.test(text)) return
    if (isContainerAware(node) || isAngularComponentResource(node, angularComponents)) return

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

/** Angular's compiler rewrites component metadata URLs before the remote is deployed. */
function isAngularComponentResource(
  node: ts.StringLiteralLike,
  angularComponents: ReadonlySet<string>,
): boolean {
  const parent = node.parent
  const property = ts.isPropertyAssignment(parent)
    ? parent
    : ts.isArrayLiteralExpression(parent) && ts.isPropertyAssignment(parent.parent)
      ? parent.parent
      : null
  if (property === null) return false

  const name = propertyName(property)
  if (
    (parent === property && name !== 'templateUrl' && name !== 'styleUrl') ||
    (parent !== property && name !== 'styleUrls')
  )
    return false

  const metadata = property.parent
  if (!ts.isObjectLiteralExpression(metadata)) return false
  const call = metadata.parent
  return (
    ts.isCallExpression(call) &&
    call.arguments[0] === metadata &&
    ts.isDecorator(call.parent) &&
    angularComponents.has(calleeName(call) ?? '')
  )
}

/** True in a position the bundler rewrites: a specifier, `import()`, or `new URL`. */
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
