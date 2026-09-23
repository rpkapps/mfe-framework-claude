/** Read out of the route file, so the shell knows a route exists before the App is loaded. */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { CapabilityDescriptor } from '@company/mfe-core'

import {
  calleeName,
  collectCapabilities,
  objectProperty,
  parseSourceFile,
  stringLiteralValue,
  ts,
  unwrapExpression,
  walk,
  type CapabilityMarker,
  type CapabilityOwner,
  type ContainerSources,
  type MarkerTerms,
} from '@company/mfe-build'

const ROUTE_EXTENSIONS = ['.ts', '.tsx'] as const

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
      const marker = asFileRouteMarker(file, sourceFile, node)
      if (marker !== null) markers.push(marker)
    })
  }

  return collectCapabilities(markers, options, FILE_ROUTE_TERMS)
}

/** Every route source file, in a stable order. */
function routeFiles(routesDirectory: string): readonly string[] {
  let entries: readonly string[]
  try {
    entries = readdirSync(routesDirectory, { recursive: true, encoding: 'utf8' })
  } catch {
    return []
  }

  return entries
    .filter(entry => ROUTE_EXTENSIONS.some(extension => entry.endsWith(extension)))
    .filter(entry => !entry.endsWith('.d.ts'))
    .map(entry => join(routesDirectory, entry))
    .sort()
}

/** Matches `createFileRoute('<path>')({ … })`; a route whose path is computed is not marked. */
function asFileRouteMarker(
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): CapabilityMarker | null {
  if (!ts.isCallExpression(node)) return null

  const inner = unwrapExpression(node.expression)
  if (!ts.isCallExpression(inner)) return null
  if (calleeName(inner) !== 'createFileRoute') return null

  const routePath = stringLiteralValue(inner.arguments[0])
  if (routePath === null) return null

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

  return { file, sourceFile, capability, path: () => routePath }
}
