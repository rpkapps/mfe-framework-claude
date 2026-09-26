/**
 * An App's file routes, read out of its routes directory so the shell knows every path the App
 * serves, and the search params each one reads, before the App is loaded. TanStack Router's own
 * path syntax is written in the neutral one on the way out: `$id` and `{$id}` are `:id`, `{-$id}`
 * is `:id?`, a bare `$` is `*`, and a pathless layout (`_auth`) or a group (`(admin)`) adds no
 * segment.
 */

import type { JsonSchemaObject, PublishedRoute } from '@company/mfe-core'

import {
  calleeName,
  collectTopLevelBindings,
  mergeSearch,
  objectProperty,
  parseSourceFile,
  readSearchSchema,
  stringLiteralValue,
  ts,
  unwrapExpression,
  walk,
  type ContainerSources,
} from '@company/mfe-build'

import { routeFiles } from './route-files.ts'

/** The validator adapters a route may wrap its schema in; the schema is their one argument. */
const SEARCH_VALIDATOR_WRAPPERS = new Set(['zodValidator', 'zodSearchValidator'])

export interface ExtractRoutesOptions {
  /** Absolute path of the routes directory. */
  readonly routesDirectory: string
  /** The plan's sources, which the route files usually are among. */
  readonly sources?: ContainerSources
}

interface FileRoute {
  /** The path as the route file writes it, trailing slash dropped: the router's own syntax. */
  readonly segments: readonly string[]
  /** Written with a trailing slash: the route rendered at its parent's own path. */
  readonly index: boolean
  readonly search: JsonSchemaObject | undefined
}

/**
 * Every file route the App serves, with the search params it reads merged over those of the
 * routes it is nested in, the root route's included. A layout that adds no segment of its own is
 * not a destination, so it is not listed; its search params reach the routes inside it.
 */
export function extractRoutes(options: ExtractRoutesOptions): readonly PublishedRoute[] {
  const parse = (file: string): ts.SourceFile =>
    options.sources === undefined ? parseSourceFile(file) : options.sources.parse(file)

  let rootSearch: JsonSchemaObject | undefined
  const routes: FileRoute[] = []

  for (const file of routeFiles(options.routesDirectory)) {
    const sourceFile = parse(file)
    walk(sourceFile, node => {
      const found = asRoute(node)
      if (found === null) return
      const search =
        found.validateSearch === undefined
          ? undefined
          : readSearchSchema(resolveSchema(sourceFile, found.validateSearch), { file, sourceFile })
      if (found.path === null) rootSearch = search
      else
        routes.push({ segments: segmentsOf(found.path), index: found.path.endsWith('/'), search })
    })
  }

  const published: PublishedRoute[] = []
  for (const route of routes) {
    const last = route.segments.at(-1)
    if (!route.index && last !== undefined && addsNoSegment(last)) continue

    let search = rootSearch
    const ancestors = routes
      .filter(other => isAncestor(other, route))
      .sort((a, b) => a.segments.length - b.segments.length)
    for (const ancestor of ancestors) search = mergeSearch(search, ancestor.search)
    search = mergeSearch(search, route.search)

    const path = neutralPath(route.segments)
    if (path === null) continue
    published.push(search === undefined ? { path } : { path, search })
  }
  return published
}

/**
 * `createFileRoute('<path>')({ … })`, or the root route, `createRootRoute({ … })` or
 * `createRootRouteWithContext<…>()({ … })`, whose `path` is `null`. A route whose path is
 * computed is not read.
 */
function asRoute(
  node: ts.Node,
): { readonly path: string | null; readonly validateSearch: ts.Expression | undefined } | null {
  if (!ts.isCallExpression(node)) return null

  const inner = unwrapExpression(node.expression)
  let path: string | null
  let optionsArgument: ts.Expression | undefined
  if (ts.isCallExpression(inner) && calleeName(inner) === 'createFileRoute') {
    path = stringLiteralValue(inner.arguments[0])
    if (path === null) return null
    optionsArgument = node.arguments[0]
  } else if (ts.isCallExpression(inner) && calleeName(inner) === 'createRootRouteWithContext') {
    path = null
    optionsArgument = node.arguments[0]
  } else if (calleeName(node) === 'createRootRoute') {
    path = null
    optionsArgument = node.arguments[0]
  } else {
    return null
  }

  const options = optionsArgument === undefined ? undefined : unwrapExpression(optionsArgument)
  const validateSearch =
    options !== undefined && ts.isObjectLiteralExpression(options)
      ? objectProperty(options, 'validateSearch')?.initializer
      : undefined
  return { path, validateSearch }
}

/** Through a validator adapter's call and a module-level `const`, to the schema itself. */
function resolveSchema(sourceFile: ts.SourceFile, expression: ts.Expression): ts.Expression {
  let current = unwrapExpression(expression)
  if (
    ts.isCallExpression(current) &&
    current.arguments.length === 1 &&
    SEARCH_VALIDATOR_WRAPPERS.has(calleeName(current) ?? '')
  ) {
    const [argument] = current.arguments
    if (argument !== undefined) current = unwrapExpression(argument)
  }
  if (ts.isIdentifier(current)) {
    const bound = collectTopLevelBindings(sourceFile).get(current.text)
    if (bound !== undefined) return bound
  }
  return current
}

function segmentsOf(path: string): readonly string[] {
  return path.split('/').filter(segment => segment !== '')
}

/**
 * A route is nested in every route whose path is a prefix of its own, TanStack Router's rule, and
 * an index route also in the route of its own path. No route is nested in an index route.
 */
function isAncestor(outer: FileRoute, inner: FileRoute): boolean {
  if (outer.index) return false
  const longest = inner.index ? inner.segments.length : inner.segments.length - 1
  return (
    outer.segments.length <= longest &&
    outer.segments.every((segment, position) => segment === inner.segments[position])
  )
}

/** A pathless layout (`_auth`) or a group (`(admin)`). */
function addsNoSegment(segment: string): boolean {
  return segment.startsWith('_') || (segment.startsWith('(') && segment.endsWith(')'))
}

/** `null` when a segment has no neutral spelling. */
function neutralPath(segments: readonly string[]): string | null {
  const neutral: string[] = []
  for (const segment of segments) {
    if (addsNoSegment(segment)) continue
    const written = neutralSegment(segment)
    if (written === null) return null
    neutral.push(written)
  }
  return `/${neutral.join('/')}`
}

/**
 * A parameter that is the whole segment. One with a prefix or a suffix (`{$id}.json`) has no
 * spelling in the neutral syntax, so its route is left out, as one whose path is computed is.
 */
function neutralSegment(segment: string): string | null {
  // A trailing `_` takes a route out of its parent's layout; it is not part of the URL.
  const plain = segment.endsWith('_') ? segment.slice(0, -1) : segment
  if (plain === '$' || plain === '{$}') return '*'
  const whole = /^(?:\$(\w+)|\{\$(\w+)\}|\{-\$(\w+)\})$/.exec(plain)
  if (whole === null) return /[{}$]/.test(plain) ? null : plain
  const [, short, braced, optional] = whole
  return optional === undefined ? `:${short ?? braced ?? ''}` : `:${optional}?`
}
