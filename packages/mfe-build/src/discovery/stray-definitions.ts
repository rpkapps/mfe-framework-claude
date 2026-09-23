/** Discovery reads the designated entry alone, so a `createWidget` call elsewhere never loads. */

import { readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'

import { createBuildError } from '../diagnostics.ts'
import { posixRelative } from '../generate/emit.ts'
import { standaloneSources, type ContainerSources } from './sources.ts'
import { callsTo, importedLocals, positionOf } from './ts-ast.ts'

const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const
const FACTORY_NAMES = ['createApp', 'createWidget'] as const

const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', '__tests__', '__mocks__'])
const TEST_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/

export interface StrayDefinitionOptions {
  /** The designated entry, which is the one file allowed to declare them. */
  readonly entryFile: string
  /** The modules `createApp` and `createWidget` may be imported from. */
  readonly factoryModules: readonly string[]
  /** The container's sources, as `containerSourceFiles` lists them. */
  readonly sourceFiles: readonly string[]
  readonly sources?: ContainerSources
}

/** Reports every definition declared outside the designated entry module. */
export function findStrayDefinitions(
  sourceRoot: string,
  options: StrayDefinitionOptions,
): readonly Error[] {
  const sources = options.sources ?? standaloneSources()
  const errors: Error[] = []

  for (const file of options.sourceFiles) {
    if (file === options.entryFile) continue
    if (isTestFile(file)) continue
    // A factory is imported by a string literal naming its module, so a file that never mentions
    // one declares nothing, and most files are never parsed.
    const text = sources.read(file)
    if (!options.factoryModules.some(module => text.includes(module))) continue

    const sourceFile = sources.parse(file)
    const factories = importedLocals(sourceFile, options.factoryModules, FACTORY_NAMES)

    for (const { call, callee } of callsTo(sourceFile, factories)) {
      const { line, column } = positionOf(sourceFile, call)
      errors.push(
        createBuildError({
          code: 'registry/invalid-entry',
          file,
          line,
          column,
          operation: 'collect the definitions this container exports',
          expected: `every definition to be declared in ${posixRelative(sourceRoot, options.entryFile)}`,
          observed: `${callee}(…) in another module`,
          declaredBy: 'Static discovery',
          repair:
            'Move the call into the container entry and export it from there. Discovery reads the entry only, so a definition declared anywhere else is never built into the container and never reaches the shell.',
        }),
      )
    }
  }

  return errors
}

/** A test declares fixtures, not the container, so what it contains is never discovered. */
export function isTestFile(file: string): boolean {
  return TEST_PATTERN.test(file)
}

/** Every TypeScript source of a container, in a stable order. */
export function containerSourceFiles(
  root: string,
  ignored: ReadonlySet<string> = new Set(),
): readonly string[] {
  const files: string[] = []

  const visit = (directory: string): void => {
    let entries: readonly Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of [...entries].sort((left, right) => (left.name < right.name ? -1 : 1))) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (
          IGNORED_DIRECTORIES.has(entry.name) ||
          ignored.has(full) ||
          entry.name.startsWith('.')
        ) {
          continue
        }
        visit(full)
        continue
      }
      if (SOURCE_EXTENSIONS.some(extension => entry.name.endsWith(extension))) {
        if (entry.name.endsWith('.d.ts')) continue
        files.push(full)
      }
    }
  }

  visit(root)
  return files
}
