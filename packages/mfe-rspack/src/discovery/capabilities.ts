/** Read out of the route file, so the shell knows a route exists before the App is loaded. */

import type { CapabilityDescriptor } from '@company/mfe-core'

import {
  calleeName,
  collectCapabilities,
  createBuildError,
  objectProperty,
  parseSourceFile,
  positionOf,
  stringLiteralValue,
  ts,
  unwrapExpression,
  walk,
  type CapabilityMarker,
  type CapabilityOwner,
  type ContainerSources,
  type MarkerTerms,
} from '@company/mfe-build'

import { routeFiles } from './route-files.ts'
import { neutralRoutePath } from './routes.ts'

/** A file route marks a capability in its `staticData`, so that is what a repair names. */
const FILE_ROUTE_TERMS: MarkerTerms = {
  removeOne: 'the staticData marker from one of them',
  drop: 'drop the staticData marker',
}

export interface ExtractCapabilitiesOptions extends CapabilityOwner {
  /** Absolute path of the routes directory. */
  readonly routesDirectory: string
  /** The plan's sources, which the route files usually are among. */
  readonly sources?: ContainerSources
}

/** Sorted by capability name, so the descriptor is identical between builds. */
export function extractCapabilities(
  options: ExtractCapabilitiesOptions,
): readonly CapabilityDescriptor[] {
  const markers: CapabilityMarker[] = []
  const parse = (file: string): ts.SourceFile =>
    options.sources === undefined ? parseSourceFile(file) : options.sources.parse(file)

  for (const file of routeFiles(options.routesDirectory)) {
    const sourceFile = parse(file)

    walk(sourceFile, node => {
      const marker = asFileRouteMarker(file, sourceFile, node, options)
      if (marker !== null) markers.push(marker)
    })
  }

  return collectCapabilities(markers, options, FILE_ROUTE_TERMS)
}

/** Matches `createFileRoute('<path>')({ … })`; a route whose path is computed is not marked. */
function asFileRouteMarker(
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  owner: CapabilityOwner,
): CapabilityMarker | null {
  if (!ts.isCallExpression(node)) return null

  const inner = unwrapExpression(node.expression)
  if (!ts.isCallExpression(inner)) return null
  if (calleeName(inner) !== 'createFileRoute') return null

  const routeArgument = inner.arguments[0]
  const routePath = stringLiteralValue(routeArgument)
  if (routeArgument === undefined || routePath === null) return null

  const optionsArgument = node.arguments[0]
  if (optionsArgument === undefined) return null
  const options = unwrapExpression(optionsArgument)
  if (!ts.isObjectLiteralExpression(options)) return null

  const staticData = objectProperty(options, 'staticData')
  if (staticData === undefined) return null
  const value = unwrapExpression(staticData.initializer)
  if (!ts.isObjectLiteralExpression(value)) return null
  const capability = objectProperty(value, 'capability')
  if (capability === undefined) return null

  return {
    file,
    sourceFile,
    capability,
    path: () => capabilityPath(file, sourceFile, owner, routeArgument, routePath),
  }
}

/**
 * Published in the one syntax an App's routes are published in, so a pathless layout or a group
 * the route sits in adds nothing to the URL the shell opens.
 */
function capabilityPath(
  file: string,
  sourceFile: ts.SourceFile,
  owner: CapabilityOwner,
  argument: ts.Expression,
  routePath: string,
): string {
  const path = neutralRoutePath(routePath)
  if (path !== null) return path

  const { line, column } = positionOf(sourceFile, argument)
  throw createBuildError({
    code: 'registry/invalid-entry',
    file,
    line,
    column,
    ...(owner.appId === undefined ? {} : { id: owner.appId }),
    operation: `extract the capability route '${routePath}'`,
    expected: 'a path whose every parameter is a whole segment, such as /settings/$id',
    observed: `'${routePath}'`,
    declaredBy: 'The published route syntax',
    repair:
      'Mark a route whose parameters each take a whole segment, or drop the staticData marker and let the route be an ordinary one.',
  })
}
