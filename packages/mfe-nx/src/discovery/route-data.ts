/**
 * An Angular App's routes are one array of object literals rather than a file per route, so a
 * capability is found at its `mfeRouteData(…)` call and its path is the literal `path` of that
 * route joined with the paths of the routes whose `children` hold it.
 */

import {
  callsTo,
  collectImportedBindings,
  collectTopLevelBindings,
  createBuildError,
  describeNode,
  findExportedExpression,
  importedLocals,
  objectProperty,
  positionOf,
  propertyName,
  resolveRelativeModule,
  stringLiteralValue,
  ts,
  unwrapExpression,
  type ContainerSources,
} from '@company/mfe-build'

import { ANGULAR_ADAPTER } from '../adapter.ts'

/** The adapter's route-data factory; the build reads its argument, never its result. */
export const ROUTE_DATA_FACTORY = 'mfeRouteData'

/** Where the routes array `createApp` receives is declared, by position in its file. */
interface RoutesArray {
  readonly file: string
  readonly pos: number
  readonly end: number
}

/** The array itself, or a description of what the build found instead and could not follow. */
export type AppRoutes = RoutesArray | { readonly unresolved: string }

/**
 * Follows `createApp({ routes })` to an array literal: inline, a top-level `const` in the entry,
 * or an exported `const` of a relative module the entry imports it from.
 */
export function resolveAppRoutes(entryFile: string, sources: ContainerSources): AppRoutes {
  const sourceFile = sources.parse(entryFile)
  const factories = importedLocals(sourceFile, [ANGULAR_ADAPTER], ['createApp'])

  for (const { call } of callsTo(sourceFile, factories)) {
    const options = call.arguments[0]
    if (options === undefined) continue
    const literal = unwrapExpression(options)
    if (!ts.isObjectLiteralExpression(literal)) continue
    const routes = routesOption(literal)
    if (routes !== undefined) return followToArray(sourceFile, routes, sources)
  }

  return { unresolved: 'createApp without a routes option' }
}

/** `routes: appRoutes`, or the shorthand `{ routes }`. */
function routesOption(options: ts.ObjectLiteralExpression): ts.Expression | undefined {
  for (const property of options.properties) {
    if (propertyName(property) !== 'routes') continue
    if (ts.isPropertyAssignment(property)) return property.initializer
    if (ts.isShorthandPropertyAssignment(property)) return property.name
  }
  return undefined
}

/** One hop into another module is enough for the `export const routes: Routes = […]` idiom. */
function followToArray(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  sources: ContainerSources,
): AppRoutes {
  const node = unwrapExpression(expression)
  if (ts.isArrayLiteralExpression(node)) {
    return { file: sourceFile.fileName, pos: node.pos, end: node.end }
  }
  if (!ts.isIdentifier(node)) return { unresolved: writtenAs(sourceFile, node) }

  const local = collectTopLevelBindings(sourceFile).get(node.text)
  if (local !== undefined) return arrayOrUnresolved(sourceFile, local)

  const binding = collectImportedBindings(sourceFile).get(node.text)
  const file =
    binding === undefined
      ? null
      : resolveRelativeModule(sourceFile.fileName, binding.moduleSpecifier)
  if (binding === undefined || file === null) {
    return { unresolved: `createApp routes from ${node.text}, which is not a relative import` }
  }

  const imported = sources.parse(file)
  const exported = findExportedExpression(imported, binding.imported)
  if (exported === null) {
    return {
      unresolved: `createApp routes from ${node.text}, which ${binding.moduleSpecifier} does not export as a const`,
    }
  }
  return arrayOrUnresolved(imported, exported)
}

function arrayOrUnresolved(sourceFile: ts.SourceFile, expression: ts.Expression): AppRoutes {
  const node = unwrapExpression(expression)
  return ts.isArrayLiteralExpression(node)
    ? { file: sourceFile.fileName, pos: node.pos, end: node.end }
    : { unresolved: writtenAs(sourceFile, node) }
}

function writtenAs(sourceFile: ts.SourceFile, node: ts.Node): string {
  return `createApp routes written as ${describeNode(sourceFile, node)}`
}

/** Every `mfeRouteData(…)` call bound to the Angular adapter, by alias or through a namespace. */
export function routeDataCalls(sourceFile: ts.SourceFile): readonly ts.CallExpression[] {
  const callees = importedLocals(sourceFile, [ANGULAR_ADAPTER], [ROUTE_DATA_FACTORY], {
    namespaces: true,
  })
  return callsTo(sourceFile, callees).map(({ call }) => call)
}

/** The build reads the route data without running it, so it has to be written in the call. */
export function routeDataObject(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  appId: string | undefined,
): ts.ObjectLiteralExpression {
  const argument = call.arguments[0]
  const data = argument === undefined ? undefined : unwrapExpression(argument)
  if (data !== undefined && ts.isObjectLiteralExpression(data)) return data

  const { line, column } = positionOf(sourceFile, call)
  throw createBuildError({
    code: 'registry/invalid-entry',
    file: sourceFile.fileName,
    line,
    column,
    ...(appId === undefined ? {} : { id: appId }),
    operation: 'extract a capability route',
    expected: `${ROUTE_DATA_FACTORY}({ … }) with an inline object literal`,
    observed: describeNode(sourceFile, call),
    declaredBy: 'The capability contract',
    repair: `Write the route data inline, for example data: ${ROUTE_DATA_FACTORY}({ capability: 'settings', label: 'Order settings' }). The build reads it without running your code, so data built elsewhere cannot be read.`,
  })
}

type Reject = (anchor: ts.Node, expected: string, observed: string, repair: string) => never

/**
 * The App-relative path of the route whose `data` is this call: its own literal path, then each
 * parent's, up to the array `createApp` receives. Any other shape is an error rather than a guess,
 * because a wrong path sends the shell somewhere the App does not serve.
 */
export function routeDataPath(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  appRoutes: AppRoutes,
  context: { readonly name: string; readonly appId?: string },
): string {
  const reject: Reject = (anchor, expected, observed, repair) => {
    const { line, column } = positionOf(sourceFile, anchor)
    throw createBuildError({
      code: 'registry/invalid-entry',
      file: sourceFile.fileName,
      line,
      column,
      ...(context.appId === undefined ? {} : { id: context.appId }),
      operation: `resolve the path of the '${context.name}' capability route`,
      expected,
      observed,
      declaredBy: 'The capability contract',
      repair,
    })
  }

  const property = outerExpression(call).parent
  const route = property.parent
  if (
    !ts.isPropertyAssignment(property) ||
    propertyName(property) !== 'data' ||
    !ts.isObjectLiteralExpression(route)
  ) {
    return reject(
      call,
      `data: ${ROUTE_DATA_FACTORY}({ … }) on a route object`,
      `${ROUTE_DATA_FACTORY}(…) inside ${describeNode(sourceFile, property)}`,
      `Declare the route inline with the call as its data, for example { path: 'settings', loadComponent: () => import('./settings.component'), data: ${ROUTE_DATA_FACTORY}({ capability: 'settings', label: 'Order settings' }) }.`,
    )
  }

  const segments: string[] = []
  let current: ts.ObjectLiteralExpression = route
  for (;;) {
    segments.unshift(literalPath(current, reject))

    const array = outerExpression(current).parent
    if (!ts.isArrayLiteralExpression(array)) {
      return reject(
        current,
        'the route written inline in a routes array',
        `a route object in ${describeNode(sourceFile, array)}`,
        'Write the route object directly in the routes array, or in an inline children: [ … ] of a route there. A route reached through a variable cannot be traced to a URL at build time.',
      )
    }

    const holder = outerExpression(array).parent
    const parent = holder.parent
    if (
      ts.isPropertyAssignment(holder) &&
      propertyName(holder) === 'children' &&
      ts.isObjectLiteralExpression(parent)
    ) {
      current = parent
      continue
    }

    if (!isAppRoutes(sourceFile, array, appRoutes)) {
      return reject(
        array,
        'a route in the routes array createApp receives, nested only through inline children: [ … ]',
        'unresolved' in appRoutes
          ? appRoutes.unresolved
          : `a routes array ${describeHolder(sourceFile, holder)}`,
        'Move the capability route into the routes array createApp receives, or into an inline children: [ … ] of a route there. An array reached through an identifier, a spread or loadChildren cannot be traced to a URL at build time.',
      )
    }

    return `/${segments.filter(segment => segment !== '').join('/')}`
  }
}

/** The node whose parent tells where an expression sits, past parentheses and type assertions. */
function outerExpression(node: ts.Node): ts.Node {
  let current = node
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent) ||
    ts.isNonNullExpression(current.parent)
  ) {
    current = current.parent
  }
  return current
}

function literalPath(route: ts.ObjectLiteralExpression, reject: Reject): string {
  const path = objectProperty(route, 'path')
  const value = path === undefined ? null : stringLiteralValue(path.initializer)
  if (value !== null) return value

  const sourceFile = route.getSourceFile()
  return reject(
    path ?? route,
    'a string-literal path on the route and on every route above it',
    path === undefined ? 'a route without a path' : describeNode(sourceFile, path.initializer),
    "Write each path inline, for example path: 'settings'. The shell navigates to the path the build recorded, so it cannot be computed or matched.",
  )
}

function isAppRoutes(
  sourceFile: ts.SourceFile,
  array: ts.ArrayLiteralExpression,
  appRoutes: AppRoutes,
): boolean {
  return (
    'file' in appRoutes &&
    appRoutes.file === sourceFile.fileName &&
    appRoutes.pos === array.pos &&
    appRoutes.end === array.end
  )
}

function describeHolder(sourceFile: ts.SourceFile, holder: ts.Node): string {
  if (ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) {
    return `bound to ${holder.name.text}`
  }
  return `in ${describeNode(sourceFile, holder)}`
}
