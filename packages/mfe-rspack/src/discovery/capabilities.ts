/**
 * Capability routes: `createFileRoute('/settings')({ staticData: { capability,
 * label, icon } })`. Read out of the route file so the shell knows the route
 * exists before the App is loaded, and the App keeps one routing table instead
 * of a registration list that can disagree with it. The path is the
 * `createFileRoute` argument, never a second copy in `staticData`.
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  CAPABILITY_NAMES,
  isCapabilityName,
  type CapabilityDescriptor,
  type CapabilityIconRef,
} from '@company/mfe-core'

import { createBuildError, listNames } from '../diagnostics.ts'
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

export interface ExtractCapabilitiesOptions {
  /** Absolute path of the routes directory. */
  readonly routesDirectory: string
  /** The App's id, for diagnostics. Absent for a Widget-only container. */
  readonly appId?: string
  /** False when the container exports no App; a capability is then an error. */
  readonly hasApp: boolean
}

/** Sorted by capability name, so the descriptor is identical between builds. */
export function extractCapabilities(
  options: ExtractCapabilitiesOptions,
): readonly CapabilityDescriptor[] {
  const found: { descriptor: CapabilityDescriptor; file: string }[] = []

  for (const file of routeFiles(options.routesDirectory)) {
    const sourceFile = parseSourceFile(file)

    walk(sourceFile, node => {
      const marked = asMarkedRoute(node)
      if (marked === null) return

      const descriptor = readCapability(sourceFile, file, marked, options)
      if (descriptor === null) return
      found.push({ descriptor, file })
    })
  }

  const byName = new Map<string, { descriptor: CapabilityDescriptor; file: string }>()
  for (const entry of found) {
    const existing = byName.get(entry.descriptor.name)
    if (existing !== undefined) {
      throw createBuildError({
        code: 'registry/invalid-descriptor',
        file: entry.file,
        ...(options.appId === undefined ? {} : { id: options.appId }),
        operation: `extract the '${entry.descriptor.name}' capability route`,
        expected: 'one route per capability',
        observed: `'${existing.descriptor.path}' and '${entry.descriptor.path}' both declare it`,
        declaredBy: 'The capability contract',
        repair:
          'Remove the staticData marker from one of them. The shell opens exactly one route per capability, so two candidates have no tie-break.',
      })
    }
    byName.set(entry.descriptor.name, entry)
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

interface MarkedRoute {
  readonly routePath: string
  readonly staticData: ts.ObjectLiteralExpression
  readonly node: ts.Node
}

/**
 * Matches `createFileRoute('<path>')({ … })` — the call of the call. Anything
 * else, including a route whose path is computed, is not a marked route.
 */
function asMarkedRoute(node: ts.Node): MarkedRoute | null {
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
  if (objectProperty(value, 'capability') === undefined) return null

  return { routePath, staticData: value, node }
}


function readCapability(
  sourceFile: ts.SourceFile,
  file: string,
  marked: MarkedRoute,
  options: ExtractCapabilitiesOptions,
): CapabilityDescriptor | null {
  const capability = objectProperty(marked.staticData, 'capability')
  if (capability === undefined) return null

  const { line, column } = positionOf(sourceFile, capability)
  const name = stringLiteralValue(capability.initializer)

  if (name === null) {
    throw createBuildError({
      code: 'registry/invalid-descriptor',
      file,
      line,
      column,
      ...(options.appId === undefined ? {} : { id: options.appId }),
      operation: 'extract a capability route',
      expected: 'a plain string literal',
      observed: describeNode(sourceFile, capability.initializer),
      declaredBy: 'The capability contract',
      repair: `Write the capability inline, for example capability: 'settings'. The shell reads it from the build output, before the App is loaded.`,
    })
  }

  if (!isCapabilityName(name)) {
    throw createBuildError({
      code: 'registry/invalid-descriptor',
      file,
      line,
      column,
      ...(options.appId === undefined ? {} : { id: options.appId }),
      operation: 'extract a capability route',
      expected: `one of ${listNames([...CAPABILITY_NAMES])}`,
      observed: JSON.stringify(name),
      declaredBy: 'The capability contract',
      repair:
        'Use one of the three capability names, or drop the staticData marker and let the route be an ordinary one. The shell only has surfaces for those three.',
    })
  }

  if (!options.hasApp) {
    throw createBuildError({
      code: 'registry/invalid-descriptor',
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

  const label = readLabel(sourceFile, file, marked, options)
  const icon = readIcon(sourceFile, file, marked, options, name)

  return {
    name,
    label,
    ...(icon === undefined ? {} : { icon }),
    path: marked.routePath,
  }
}

function readLabel(
  sourceFile: ts.SourceFile,
  file: string,
  marked: MarkedRoute,
  options: ExtractCapabilitiesOptions,
): string {
  const label = objectProperty(marked.staticData, 'label')
  const value = label === undefined ? null : stringLiteralValue(label.initializer)

  if (value === null || value.trim() === '') {
    const anchor = label ?? marked.staticData
    const { line, column } = positionOf(sourceFile, anchor)
    throw createBuildError({
      code: 'registry/invalid-descriptor',
      file,
      line,
      column,
      ...(options.appId === undefined ? {} : { id: options.appId }),
      operation: `extract the capability route '${marked.routePath}'`,
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
  sourceFile: ts.SourceFile,
  file: string,
  marked: MarkedRoute,
  options: ExtractCapabilitiesOptions,
  name: string,
): CapabilityIconRef | undefined {
  const icon = objectProperty(marked.staticData, 'icon')
  if (icon === undefined) return undefined

  const initializer = unwrapExpression(icon.initializer)
  const { line, column } = positionOf(sourceFile, icon)

  const reject = (observed: string, repair: string): never => {
    throw createBuildError({
      code: 'registry/invalid-descriptor',
      file,
      line,
      column,
      ...(options.appId === undefined ? {} : { id: options.appId }),
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
