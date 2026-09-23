/**
 * Read out of the routes, so the shell knows a route exists before the App is loaded: a React
 * App marks a file route's `staticData`, an Angular App a route's `data: mfeRouteData(…)`.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CAPABILITY_NAMES,
  isCapabilityName,
  type CapabilityDescriptor,
  type CapabilityIconRef,
} from '@company/mfe-core'

import { createBuildError, listNames } from '../diagnostics.ts'
import {
  resolveAppRoutes,
  ROUTE_DATA_FACTORY,
  routeDataCalls,
  routeDataObject,
  routeDataPath,
  type AppRoutes,
} from './angular-routes.ts'
import {
  calleeName,
  describeNode,
  objectProperty,
  parseSourceFile,
  positionOf,
  propertyName,
  stringLiteralValue,
  ts,
  unwrapExpression,
  walk,
} from './ts-ast.ts'

const ROUTE_EXTENSIONS = ['.ts', '.tsx'] as const

/** Anything that looks like markup is markup, whatever it claims to be. */
const MARKUP_PATTERN = /[<>]/

interface CapabilityOwner {
  /** The App's id, for diagnostics; absent for a Widget-only container. */
  readonly appId?: string
  /** False when the container exports no App; a capability is then an error. */
  readonly hasApp: boolean
}

export interface ExtractCapabilitiesOptions extends CapabilityOwner {
  /** Absolute path of the routes directory. */
  readonly routesDirectory: string
}

export interface ExtractRouteDataCapabilitiesOptions extends CapabilityOwner {
  /** The entry, whose `createApp` call names the routes array every capability must sit in. */
  readonly entryFile: string
  /** The container's own sources, tests and generated output excluded. */
  readonly sourceFiles: readonly string[]
}

/** One route that declares a capability, before any of it is validated. */
interface CapabilityMarker {
  readonly file: string
  readonly sourceFile: ts.SourceFile
  /** The object literal holding `capability`, `label` and `icon`. */
  readonly data: ts.ObjectLiteralExpression
  readonly capability: ts.PropertyAssignment
  /** Resolved once the marker is known to be a capability an App declares. */
  readonly path: () => string
}

/** How the diagnostics name the marker, in the vocabulary of the author's router. */
interface MarkerTerms {
  /** Completes "Remove …": the one marker that should go. */
  readonly removeOne: string
  /** Completes "or …, and let the route be an ordinary one". */
  readonly drop: string
}

const FILE_ROUTE_TERMS: MarkerTerms = {
  removeOne: 'the staticData marker from one of them',
  drop: 'drop the staticData marker',
}

const ROUTE_DATA_TERMS: MarkerTerms = {
  removeOne: `the capability from one of their ${ROUTE_DATA_FACTORY} calls`,
  drop: `drop the capability from the ${ROUTE_DATA_FACTORY} call`,
}

/** A React App's capabilities, from its file routes; sorted, so the descriptor is stable. */
export function extractCapabilities(
  options: ExtractCapabilitiesOptions,
): readonly CapabilityDescriptor[] {
  const markers: CapabilityMarker[] = []

  for (const file of routeFiles(options.routesDirectory)) {
    const sourceFile = parseSourceFile(file)

    walk(sourceFile, node => {
      const marker = asFileRouteMarker(file, sourceFile, node)
      if (marker !== null) markers.push(marker)
    })
  }

  return collectCapabilities(markers, options, FILE_ROUTE_TERMS)
}

/**
 * An Angular App's capabilities, from `mfeRouteData(…)` anywhere in its sources; the path is
 * resolved through the route config, which is read only when a capability needs it.
 */
export function extractRouteDataCapabilities(
  options: ExtractRouteDataCapabilitiesOptions,
): readonly CapabilityDescriptor[] {
  let appRoutes: AppRoutes | undefined
  const markers: CapabilityMarker[] = []

  for (const file of options.sourceFiles) {
    const text = readFileSync(file, 'utf8')
    // Most modules never mention it, and parsing is what the scan costs.
    if (!text.includes(ROUTE_DATA_FACTORY)) continue
    const sourceFile = parseSourceFile(file, text)

    for (const call of routeDataCalls(sourceFile)) {
      const data = routeDataObject(sourceFile, call, options.appId)
      const capability = objectProperty(data, 'capability')
      if (capability === undefined) continue

      markers.push({
        file,
        sourceFile,
        data,
        capability,
        path: () => {
          appRoutes ??= resolveAppRoutes(options.entryFile)
          return routeDataPath(sourceFile, call, appRoutes, {
            name: stringLiteralValue(capability.initializer) ?? 'capability',
            ...(options.appId === undefined ? {} : { appId: options.appId }),
          })
        },
      })
    }
  }

  return collectCapabilities(markers, options, ROUTE_DATA_TERMS)
}

/** Sorted by capability name, so the descriptor is identical between builds. */
function collectCapabilities(
  markers: readonly CapabilityMarker[],
  owner: CapabilityOwner,
  terms: MarkerTerms,
): readonly CapabilityDescriptor[] {
  const byName = new Map<string, { descriptor: CapabilityDescriptor; file: string }>()

  for (const marker of markers) {
    const descriptor = readCapability(marker, owner, terms)
    const existing = byName.get(descriptor.name)
    if (existing !== undefined) {
      throw createBuildError({
        code: 'registry/invalid-entry',
        file: marker.file,
        ...(owner.appId === undefined ? {} : { id: owner.appId }),
        operation: `extract the '${descriptor.name}' capability route`,
        expected: 'one route per capability',
        observed: `'${existing.descriptor.path}' and '${descriptor.path}' both declare it`,
        declaredBy: 'The capability contract',
        repair: `Remove ${terms.removeOne}. The shell opens exactly one route per capability, so two candidates have no tie-break.`,
      })
    }
    byName.set(descriptor.name, { descriptor, file: marker.file })
  }

  return [...byName.values()]
    .map(entry => entry.descriptor)
    .sort(
      (left, right) => CAPABILITY_NAMES.indexOf(left.name) - CAPABILITY_NAMES.indexOf(right.name),
    )
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

  return { file, sourceFile, data: value, capability, path: () => routePath }
}

function readCapability(
  marker: CapabilityMarker,
  owner: CapabilityOwner,
  terms: MarkerTerms,
): CapabilityDescriptor {
  const { file, sourceFile, capability } = marker

  const { line, column } = positionOf(sourceFile, capability)
  const name = stringLiteralValue(capability.initializer)

  if (name === null) {
    throw createBuildError({
      code: 'registry/invalid-entry',
      file,
      line,
      column,
      ...(owner.appId === undefined ? {} : { id: owner.appId }),
      operation: 'extract a capability route',
      expected: 'a plain string literal',
      observed: describeNode(sourceFile, capability.initializer),
      declaredBy: 'The capability contract',
      repair: `Write the capability inline, for example capability: 'settings'. The shell reads it from the build output, before the App is loaded.`,
    })
  }

  if (!isCapabilityName(name)) {
    throw createBuildError({
      code: 'registry/invalid-entry',
      file,
      line,
      column,
      ...(owner.appId === undefined ? {} : { id: owner.appId }),
      operation: 'extract a capability route',
      expected: `one of ${listNames([...CAPABILITY_NAMES])}`,
      observed: JSON.stringify(name),
      declaredBy: 'The capability contract',
      repair: `Use one of the three capability names, or ${terms.drop} and let the route be an ordinary one. The shell only has surfaces for those three.`,
    })
  }

  if (!owner.hasApp) {
    throw createBuildError({
      code: 'registry/invalid-entry',
      file,
      line,
      column,
      operation: `extract the '${name}' capability route`,
      expected: 'a capability declared by an App',
      observed: 'a container that exports Widgets only',
      declaredBy: 'The capability contract',
      repair:
        'Remove the marker. Capabilities are App-only: the shell opens them as a route, and a Widget has no routes of its own.',
    })
  }

  const path = marker.path()
  const label = readLabel(marker, owner, path)
  const icon = readIcon(marker, owner, name)

  return {
    name,
    label,
    ...(icon === undefined ? {} : { icon }),
    path,
  }
}

function readLabel(marker: CapabilityMarker, owner: CapabilityOwner, path: string): string {
  const { file, sourceFile } = marker
  const label = objectProperty(marker.data, 'label')
  const value = label === undefined ? null : stringLiteralValue(label.initializer)

  if (value === null || value.trim() === '') {
    const anchor = label ?? marker.data
    const { line, column } = positionOf(sourceFile, anchor)
    throw createBuildError({
      code: 'registry/invalid-entry',
      file,
      line,
      column,
      ...(owner.appId === undefined ? {} : { id: owner.appId }),
      operation: `extract the capability route '${path}'`,
      expected: 'a non-empty `label` string literal',
      observed: label === undefined ? 'no label' : describeNode(sourceFile, label.initializer),
      declaredBy: 'The capability contract',
      repair:
        "Add the text the shell puts in its menu, for example label: 'Order settings'. It is read at build time, so it cannot be computed.",
    })
  }

  return value
}

function readIcon(
  marker: CapabilityMarker,
  owner: CapabilityOwner,
  name: string,
): CapabilityIconRef | undefined {
  const { file, sourceFile } = marker
  const icon = objectProperty(marker.data, 'icon')
  if (icon === undefined) return undefined

  const initializer = unwrapExpression(icon.initializer)
  const { line, column } = positionOf(sourceFile, icon)

  const reject = (observed: string, repair: string): never => {
    throw createBuildError({
      code: 'registry/invalid-entry',
      file,
      line,
      column,
      ...(owner.appId === undefined ? {} : { id: owner.appId }),
      operation: `extract the icon for the '${name}' capability`,
      expected: "an icon name from the shell set, or { src: '<url>' }",
      observed,
      declaredBy: 'The capability contract',
      repair,
    })
  }

  const literal = stringLiteralValue(initializer)
  if (literal !== null) {
    if (MARKUP_PATTERN.test(literal)) {
      return reject(
        'markup',
        "Pass an icon name, for example icon: 'gear', or a URL as { src: '/icons/gear.svg' }. The shell never inserts author markup into its own DOM, so SVG source is not accepted in any form.",
      )
    }
    if (literal.trim() === '') {
      return reject('an empty string', "Name an icon, for example icon: 'gear', or omit the field.")
    }
    return literal
  }

  if (ts.isObjectLiteralExpression(initializer)) {
    const src = objectProperty(initializer, 'src')
    const value = src === undefined ? null : stringLiteralValue(src.initializer)
    const extra = initializer.properties
      .map(property => propertyName(property))
      .filter((key): key is string => key !== null && key !== 'src')

    if (value === null) {
      return reject(
        src === undefined ? 'an object without a src' : describeNode(sourceFile, src.initializer),
        "Give the object a literal src, for example icon: { src: '/icons/gear.svg' }. It renders in an <img>, so it has to be a URL the browser can fetch.",
      )
    }
    if (extra.length > 0) {
      return reject(
        `extra propert${extra.length === 1 ? 'y' : 'ies'} ${listNames(extra)}`,
        'Keep the object to a single src property. Nothing else is carried into the shell.',
      )
    }
    if (MARKUP_PATTERN.test(value)) {
      return reject(
        'markup in src',
        "Point src at a file, for example { src: '/icons/gear.svg' }. Inline markup and data URLs holding SVG source are never accepted.",
      )
    }
    if (value.trim().toLowerCase().startsWith('data:image/svg')) {
      return reject(
        'an SVG data URL',
        "Point src at a file the browser fetches, for example { src: '/icons/gear.svg' }. An inline SVG document is author markup wearing a URL.",
      )
    }
    return { src: value }
  }

  return reject(
    describeNode(sourceFile, initializer),
    "Write the icon inline, either as a name (icon: 'gear') or as { src: '/icons/gear.svg' }.",
  )
}
