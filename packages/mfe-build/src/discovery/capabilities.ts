/**
 * What a capability route declares is the same whichever router marks it, so the rules for it live
 * here and each integration only finds the markers: the shell knows a route exists before the App
 * is loaded.
 */

import {
  CAPABILITY_NAMES,
  isCapabilityName,
  type CapabilityDescriptor,
  type CapabilityIconRef,
} from '@company/mfe-core'

import { createBuildError, listNames } from '../diagnostics.ts'
import {
  describeNode,
  objectProperty,
  positionOf,
  propertyName,
  stringLiteralValue,
  ts,
  unwrapExpression,
} from './ts-ast.ts'

/** Anything that looks like markup is markup, whatever it claims to be. */
const MARKUP_PATTERN = /[<>]/

/** Who declares the capabilities, which decides whether declaring one is allowed at all. */
export interface CapabilityOwner {
  /** The App's id, for diagnostics; absent for a Widget-only container. */
  readonly appId?: string
  /** False when the container exports no App; a capability is then an error. */
  readonly hasApp: boolean
}

/** One route that declares a capability, as an integration's reader found it: not yet validated. */
export interface CapabilityMarker {
  readonly file: string
  readonly sourceFile: ts.SourceFile
  /** The `capability` property, whose value should be `{ name, label, icon? }`. */
  readonly capability: ts.PropertyAssignment
  /** Read only once the marker is known to be a valid capability of an App. */
  readonly path: () => string
}

/** How the diagnostics name a marker, in the vocabulary of the author's router. */
export interface MarkerTerms {
  /** Completes "Remove …": the one marker of two that should go. */
  readonly removeOne: string
  /** Completes "or …, and let the route be an ordinary one". */
  readonly drop: string
}

/** Sorted by capability name, so the descriptor is identical between builds. */
export function collectCapabilities(
  markers: readonly CapabilityMarker[],
  owner: CapabilityOwner,
  terms: MarkerTerms,
): readonly CapabilityDescriptor[] {
  // Every marker is validated before any two are compared, so a malformed one is reported first.
  const found = markers.map(marker => ({
    descriptor: readCapability(marker, owner, terms),
    file: marker.file,
  }))

  const byName = new Map<string, { descriptor: CapabilityDescriptor; file: string }>()
  for (const entry of found) {
    const existing = byName.get(entry.descriptor.name)
    if (existing !== undefined) {
      throw createBuildError({
        code: 'registry/invalid-entry',
        file: entry.file,
        ...(owner.appId === undefined ? {} : { id: owner.appId }),
        operation: `extract the '${entry.descriptor.name}' capability route`,
        expected: 'one route per capability',
        observed: `'${existing.descriptor.path}' and '${entry.descriptor.path}' both declare it`,
        declaredBy: 'The capability contract',
        repair: `Remove ${terms.removeOne}. The shell opens exactly one route per capability, so two candidates have no tie-break.`,
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

function readCapability(
  marker: CapabilityMarker,
  owner: CapabilityOwner,
  terms: MarkerTerms,
): CapabilityDescriptor {
  const { file, sourceFile, capability } = marker
  const data = readCapabilityObject(marker, owner)

  const nameProperty = objectProperty(data, 'name')
  const anchor = nameProperty ?? data
  const { line, column } = positionOf(sourceFile, anchor)
  const name = nameProperty === undefined ? null : stringLiteralValue(nameProperty.initializer)

  if (name === null) {
    throw createBuildError({
      code: 'registry/invalid-entry',
      file,
      line,
      column,
      ...(owner.appId === undefined ? {} : { id: owner.appId }),
      operation: 'extract a capability route',
      expected: 'a `name` string literal',
      observed:
        nameProperty === undefined ? 'no name' : describeNode(sourceFile, nameProperty.initializer),
      declaredBy: 'The capability contract',
      repair: `Write the name inline, for example capability: { name: 'settings', label: 'Order settings' }. The shell reads it from the build output, before the App is loaded.`,
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
      repair: `Use one of the capability names, or ${terms.drop} and let the route be an ordinary one. The shell only has surfaces for those.`,
    })
  }

  if (!owner.hasApp) {
    const position = positionOf(sourceFile, capability)
    throw createBuildError({
      code: 'registry/invalid-entry',
      file,
      line: position.line,
      column: position.column,
      operation: `extract the '${name}' capability route`,
      expected: 'a capability declared by an App',
      observed: 'a container that exports Widgets only',
      declaredBy: 'The capability contract',
      repair:
        'Remove the marker. Capabilities are App-only: the shell opens them as a route, and a Widget has no routes of its own.',
    })
  }

  const path = marker.path()
  const label = readLabel(marker, data, owner, path)
  const icon = readIcon(marker, data, owner, name)

  return {
    name,
    label,
    ...(icon === undefined ? {} : { icon }),
    path,
  }
}

/** The capability is one object, so everything the shell reads about the page sits together. */
function readCapabilityObject(
  marker: CapabilityMarker,
  owner: CapabilityOwner,
): ts.ObjectLiteralExpression {
  const { file, sourceFile, capability } = marker
  const initializer = unwrapExpression(capability.initializer)
  if (ts.isObjectLiteralExpression(initializer)) return initializer

  const { line, column } = positionOf(sourceFile, capability)
  const written = stringLiteralValue(initializer)
  throw createBuildError({
    code: 'registry/invalid-entry',
    file,
    line,
    column,
    ...(owner.appId === undefined ? {} : { id: owner.appId }),
    operation: 'extract a capability route',
    expected: 'an inline object literal { name, label, icon? }',
    observed: describeNode(sourceFile, initializer),
    declaredBy: 'The capability contract',
    repair:
      written === null
        ? "Write the capability inline, for example capability: { name: 'settings', label: 'Order settings' }. The build reads it without running your code, so an object built elsewhere cannot be read."
        : `Move the name, label and icon into one object, for example capability: { name: '${written}', label: 'Order settings' }.`,
  })
}

function readLabel(
  marker: CapabilityMarker,
  data: ts.ObjectLiteralExpression,
  owner: CapabilityOwner,
  path: string,
): string {
  const { file, sourceFile } = marker
  const label = objectProperty(data, 'label')
  const value = label === undefined ? null : stringLiteralValue(label.initializer)

  if (value === null || value.trim() === '') {
    const anchor = label ?? data
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
  data: ts.ObjectLiteralExpression,
  owner: CapabilityOwner,
  name: string,
): CapabilityIconRef | undefined {
  const { file, sourceFile } = marker
  const icon = objectProperty(data, 'icon')
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
