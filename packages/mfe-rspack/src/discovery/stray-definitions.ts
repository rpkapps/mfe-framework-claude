/** Discovery reads the designated entry alone, so a `createWidget` call elsewhere never loads. */

import { readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { createBuildError } from '../diagnostics.ts'
import { DEFINITION_MODULES } from './definitions.ts'
import {
  calleeName,
  collectImportedBindings,
  parseSourceFile,
  positionOf,
  ts,
  walk,
} from './ts-ast.ts'

const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const
const FACTORY_NAMES = new Set(['createApp', 'createWidget'])

const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', '__tests__', '__mocks__'])
const TEST_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/

export interface StrayDefinitionOptions {
  /** The designated entry, which is the one file allowed to declare them. */
  readonly entryFile: string
  /** Directories skipped entirely, such as the build-managed output. */
  readonly ignoredDirectories?: readonly string[]
}

/** Reports every definition declared outside the designated entry module. */
export function findStrayDefinitions(
  sourceRoot: string,
  options: StrayDefinitionOptions,
): readonly Error[] {
  const ignored = new Set(options.ignoredDirectories ?? [])
  const errors: Error[] = []

  for (const file of containerSourceFiles(sourceRoot, ignored)) {
    if (file === options.entryFile) continue
    if (TEST_PATTERN.test(file)) continue

    const sourceFile = parseSourceFile(file)
    const imports = collectImportedBindings(sourceFile)

    const factories = new Set<string>()
    for (const [local, binding] of imports) {
      if (!DEFINITION_MODULES.includes(binding.moduleSpecifier)) continue
      if (FACTORY_NAMES.has(binding.imported)) factories.add(local)
    }
    if (factories.size === 0) continue

    walk(sourceFile, node => {
      if (!ts.isCallExpression(node)) return
      const callee = calleeName(node)
      if (callee === null || !factories.has(callee)) return

      const { line, column } = positionOf(sourceFile, node)
      errors.push(
        createBuildError({
          code: 'registry/invalid-descriptor',
          file,
          line,
          column,
          operation: 'collect the definitions this container exports',
          expected: `every definition to be declared in ${relative(sourceRoot, options.entryFile).split(sep).join('/')}`,
          observed: `${callee}(…) in another module`,
          declaredBy: 'Static discovery',
          repair:
            'Move the call into the container entry and export it from there. Discovery reads the entry only, so a definition declared anywhere else is never built into the container and never reaches the shell.',
        }),
      )
    })
  }

  return errors
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
