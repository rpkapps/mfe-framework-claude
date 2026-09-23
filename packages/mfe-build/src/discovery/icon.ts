/**
 * Resolves the identifier an author passed as `icon` into plain data. The registry crosses an
 * origin boundary, so it carries a parsed icon and never a component or a string of markup. No
 * icon library is named here: an identifier is followed through ordinary ESM re-exports with the
 * parser, the same way a Widget's contract is read one import deep, and nothing is evaluated.
 */

import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { ICON_ELEMENT_TAGS, type IconData, type IconNode } from '@company/mfe-core'

import {
  collectTopLevelBindings,
  parseModuleFile,
  propertyName,
  stringLiteralValue,
  ts,
  unwrapExpression,
  type ImportedBinding,
} from './ts-ast.ts'

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx'] as const

/** What an icon may draw with; anything else is dropped rather than carried into a host's DOM. */
const ELEMENT_TAGS = new Set<string>(ICON_ELEMENT_TAGS)

/** Geometry and paint only: no ids, no classes, no styles, no event handlers. */
const ELEMENT_ATTRIBUTES = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'points',
  'transform',
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'clip-rule',
  'opacity',
  'vector-effect',
])

/** The root says how the icon is painted, never how large it is drawn: the host decides that. */
const ROOT_ATTRIBUTES = new Set([
  'fill',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'clip-rule',
  'opacity',
])

/**
 * An icon module declares a node array and no root attributes, because the format itself implies
 * a stroked outline. Every library using this shape draws it this way.
 */
const OUTLINE_DEFAULTS: Readonly<Record<string, string>> = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
}

/** Parsed once per build: an icon barrel runs to a quarter of a megabyte. */
const parsedFiles = new Map<string, ts.SourceFile | null>()

function parseCached(file: string): ts.SourceFile | null {
  const cached = parsedFiles.get(file)
  if (cached !== undefined) return cached

  let parsed: ts.SourceFile | null
  try {
    parsed = parseModuleFile(file)
  } catch {
    parsed = null
  }
  parsedFiles.set(file, parsed)
  return parsed
}

/**
 * The parsed icon, or `null` when the identifier does not lead to one. The caller turns `null`
 * into a build error, because it holds the source position the developer needs.
 */
export function readIconData(entryFile: string, binding: ImportedBinding): IconData | null {
  const file = resolveModule(entryFile, binding.moduleSpecifier)
  if (file === null) return null
  if (file.endsWith('.svg')) return readSvgFile(file)
  return readIconModule(file, binding.imported)
}

/** Only the fields that name an entry point; the rest of a manifest is not this file's business. */
interface PackageManifest {
  readonly module?: string
  readonly main?: string
  readonly exports?: unknown
}

/** Relative specifiers resolve on disk the way the bundler resolves them; bare ones through Node. */
function resolveModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return resolveBareModule(fromFile, specifier)

  const base = resolve(dirname(fromFile), specifier)
  const candidates = [base]
  // `./icon.js` is how a TypeScript ESM import spells `./icon.ts`.
  if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`)
  for (const extension of MODULE_EXTENSIONS) candidates.push(`${base}${extension}`)

  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Not a file: try the next candidate.
    }
  }
  return null
}

/**
 * The package's ESM entry, not whatever `require.resolve` lands on: a CommonJS bundle re-exports
 * through assignments no parser can follow, where the module build is the plain `export … from`
 * this reader walks. It is also the file the bundler itself will take.
 */
function resolveBareModule(fromFile: string, specifier: string): string | null {
  const require_ = createRequire(fromFile)

  try {
    const manifestFile = require_.resolve(`${specifier}/package.json`)
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as PackageManifest
    const entry = esmEntry(manifest)
    if (entry !== null) {
      const file = resolve(dirname(manifestFile), entry)
      try {
        if (statSync(file).isFile()) return file
      } catch {
        // The manifest names a file that is not there: fall through to Node's own answer.
      }
    }
  } catch {
    // A subpath specifier has no manifest of its own; Node resolves it directly.
  }

  try {
    return require_.resolve(specifier)
  } catch {
    return null
  }
}

function esmEntry(manifest: PackageManifest): string | null {
  if (typeof manifest.module === 'string') return manifest.module

  const exports = manifest.exports
  if (exports === null || typeof exports !== 'object') return null
  const root = (exports as Record<string, unknown>)['.'] ?? exports
  if (root === null || typeof root !== 'object') return null

  const value = (root as Record<string, unknown>)['import']
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object') {
    const nested = (value as Record<string, unknown>)['default']
    if (typeof nested === 'string') return nested
  }
  return null
}

/**
 * Follows one re-export hop, which is how every icon package publishes — a barrel of
 * `export { default as Sun, default as SunIcon } from './icons/sun.mjs'`. An identifier that
 * already points at the icon module is read where it stands.
 */
function readIconModule(file: string, exportName: string): IconData | null {
  const sourceFile = parseCached(file)
  if (sourceFile === null) return null

  const target = reExportTarget(sourceFile, exportName)
  if (target === null) return iconDataFrom(sourceFile)

  const resolved = resolveModule(file, target)
  if (resolved === null) return null
  if (resolved.endsWith('.svg')) return readSvgFile(resolved)

  const hop = parseCached(resolved)
  return hop === null ? null : iconDataFrom(hop)
}

/** The specifier an `export … from` re-exports `exportName` through. */
function reExportTarget(sourceFile: ts.SourceFile, exportName: string): string | null {
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue
    if (statement.isTypeOnly) continue
    if (statement.moduleSpecifier === undefined) continue

    const clause = statement.exportClause
    if (clause === undefined || !ts.isNamedExports(clause)) continue

    for (const element of clause.elements) {
      if (element.name.text === exportName) return stringLiteralValue(statement.moduleSpecifier)
    }
  }
  return null
}

/**
 * The one assumption made anywhere here, and it is about shape rather than about a package: an
 * icon module holds a top-level object literal with a statically readable `node` array.
 */
function iconDataFrom(sourceFile: ts.SourceFile): IconData | null {
  for (const initializer of collectTopLevelBindings(sourceFile).values()) {
    const object = unwrapExpression(initializer)
    if (!ts.isObjectLiteralExpression(object)) continue

    const node = readNodeArray(objectValue(object, 'node'))
    if (node === null || node.length === 0) continue

    const size = numericValue(objectValue(object, 'size')) ?? 24
    return { viewBox: `0 0 ${String(size)} ${String(size)}`, attributes: OUTLINE_DEFAULTS, node }
  }
  return null
}

function objectValue(object: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    if (propertyName(property) === name) return unwrapExpression(property.initializer)
  }
  return null
}

function numericValue(node: ts.Expression | null): number | null {
  if (node === null || !ts.isNumericLiteral(node)) return null
  const value = Number(node.text)
  return Number.isFinite(value) ? value : null
}

/** `[['path', { d: '…' }], …]`, with anything computed or off the allowlist dropped. */
function readNodeArray(node: ts.Expression | null): readonly IconNode[] | null {
  if (node === null || !ts.isArrayLiteralExpression(node)) return null

  const nodes: IconNode[] = []
  for (const element of node.elements) {
    const tuple = unwrapExpression(element)
    if (!ts.isArrayLiteralExpression(tuple)) continue

    const tag = stringLiteralValue(tuple.elements[0])
    if (tag === null || !ELEMENT_TAGS.has(tag)) continue

    const attributesNode = tuple.elements[1]
    const unwrappedAttributes =
      attributesNode === undefined ? null : unwrapExpression(attributesNode)
    const attributes =
      unwrappedAttributes !== null && ts.isObjectLiteralExpression(unwrappedAttributes)
        ? readAttributes(unwrappedAttributes)
        : {}

    const childrenNode = tuple.elements[2]
    const children =
      childrenNode === undefined ? null : readNodeArray(unwrapExpression(childrenNode))

    nodes.push(
      children === null || children.length === 0 ? [tag, attributes] : [tag, attributes, children],
    )
  }

  return nodes
}

/** A library's own render key is not an attribute, so it never reaches the host's DOM. */
function readAttributes(object: ts.ObjectLiteralExpression): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {}

  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = propertyName(property)
    if (name === null || !ELEMENT_ATTRIBUTES.has(name)) continue

    const value = unwrapExpression(property.initializer)
    if (ts.isNumericLiteral(value)) {
      attributes[name] = value.text
      continue
    }
    const text = stringLiteralValue(value)
    if (text !== null) attributes[name] = text
  }

  return attributes
}

/* ---------------------------------------------------------------------------
 * SVG files: the second authoring form, and the one that always works.
 * ------------------------------------------------------------------------- */

function readSvgFile(file: string): IconData | null {
  try {
    return parseSvg(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** An icon is a handful of shapes, so this reads elements and attributes and nothing else. */
export function parseSvg(source: string): IconData | null {
  const text = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '')

  const root = /<\s*svg((?:\s+[^<>]*?)?)\s*\/?\s*>/i.exec(text)
  if (root === null) return null

  const rootAttributes = readSvgAttributes(root[1] ?? '')
  const viewBox = rootAttributes['viewBox']
  if (viewBox === undefined) return null

  const attributes: Record<string, string> = {}
  for (const [name, value] of Object.entries(rootAttributes)) {
    if (ROOT_ATTRIBUTES.has(name)) attributes[name] = value
  }

  const node = readSvgChildren(text.slice(root.index + root[0].length))
  if (node.length === 0) return null

  return {
    viewBox,
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    node,
  }
}

interface OpenElement {
  readonly tag: string
  readonly attributes: Record<string, string>
  readonly children: IconNode[]
}

/** A stack rather than a flat sweep, so a `<g>` keeps the shapes it wraps. */
function readSvgChildren(body: string): readonly IconNode[] {
  const pattern = /<\s*(\/)?\s*([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)(\/)?\s*>/g
  const roots: IconNode[] = []
  const open: OpenElement[] = []

  const push = (child: IconNode): void => {
    const parent = open[open.length - 1]
    if (parent === undefined) roots.push(child)
    else parent.children.push(child)
  }

  for (let match = pattern.exec(body); match !== null; match = pattern.exec(body)) {
    const closing = match[1] !== undefined
    const tag = (match[2] ?? '').toLowerCase()
    const selfClosing = match[4] !== undefined

    if (tag === 'svg') {
      if (closing) break
      continue
    }

    if (closing) {
      const finished = open.pop()
      if (finished === undefined || finished.tag !== tag) continue
      push(
        finished.children.length === 0
          ? [finished.tag, finished.attributes]
          : [finished.tag, finished.attributes, finished.children],
      )
      continue
    }

    if (!ELEMENT_TAGS.has(tag)) continue

    const attributes: Record<string, string> = {}
    for (const [name, value] of Object.entries(readSvgAttributes(match[3] ?? ''))) {
      if (ELEMENT_ATTRIBUTES.has(name)) attributes[name] = value
    }

    if (selfClosing) push([tag, attributes])
    else open.push({ tag, attributes, children: [] })
  }

  return roots
}

function readSvgAttributes(source: string): Record<string, string> {
  const pattern = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  const attributes: Record<string, string> = {}

  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    const name = match[1]
    const value = match[2] ?? match[3]
    if (name !== undefined && value !== undefined) attributes[name] = value
  }

  return attributes
}
