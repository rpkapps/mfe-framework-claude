/** Reads a package version without evaluating the entry or importing its dependencies. */

import { basename, dirname, resolve } from 'node:path'

import { createBuildError } from '../diagnostics.ts'
import type { ContainerSources } from './sources.ts'
import { ts, unwrapExpression, type ImportedBinding } from './ts-ast.ts'

/** Only a direct JSON import is followed; arbitrary computed versions remain unsupported. */
export function importedPackageVersion(
  expression: ts.Expression,
  entryFile: string,
  id: string,
  imports: ReadonlyMap<string, ImportedBinding>,
  sources: ContainerSources,
): string | null {
  const node = unwrapExpression(expression)
  let binding: ImportedBinding | undefined
  if (ts.isIdentifier(node)) {
    const imported = imports.get(node.text)
    if (imported?.kind === 'named' && imported.imported === 'version') binding = imported
  } else if (ts.isPropertyAccessExpression(node) && node.name.text === 'version') {
    const object = unwrapExpression(node.expression)
    const imported = ts.isIdentifier(object) ? imports.get(object.text) : undefined
    if (imported?.kind === 'default' || imported?.kind === 'namespace') binding = imported
  }

  if (binding === undefined || !binding.moduleSpecifier.startsWith('.')) return null
  const file = resolve(dirname(entryFile), binding.moduleSpecifier)
  if (basename(file) !== 'package.json') return null

  let version: unknown
  try {
    const manifest: unknown = JSON.parse(sources.read(file))
    if (manifest !== null && typeof manifest === 'object' && 'version' in manifest) {
      version = manifest.version
    }
  } catch (cause) {
    throw createBuildError({
      code: 'registry/invalid-entry',
      file,
      id,
      operation: 'read the definition version',
      expected: 'a readable package.json containing valid JSON',
      observed: cause instanceof Error ? cause.message : 'a read failure',
      declaredBy: 'Static discovery',
      repair: 'Fix the package.json import or its JSON syntax and rebuild.',
      cause,
    })
  }

  if (typeof version !== 'string' || version.trim() === '') {
    throw createBuildError({
      code: 'registry/invalid-entry',
      file,
      id,
      operation: 'read the definition version',
      expected: 'a non-empty version string in package.json',
      observed: version === undefined ? 'no version' : JSON.stringify(version),
      declaredBy: 'Static discovery',
      repair: 'Set the version in package.json, for example "version": "2.1.0", and rebuild.',
    })
  }

  return version
}
