/**
 * Temporary container fixtures for the unit tests.
 *
 * Discovery, configuration reading and generation all work on real files, so
 * the tests give them real files. A fixture is a throwaway directory holding
 * exactly the sources a case needs.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const created: string[] = []

export interface ContainerFixtureOptions {
  /** Merged into the generated package.json. */
  readonly manifest?: Record<string, unknown>
}

/** Writes a container into a temporary directory and returns its root. */
export function createContainer(
  files: Readonly<Record<string, string>>,
  options: ContainerFixtureOptions = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'mfe-container-'))
  created.push(root)

  const manifest = {
    name: '@acme/operations',
    version: '1.0.0',
    type: 'module',
    dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
    ...options.manifest,
  }

  writeContainerFile(root, 'package.json', `${JSON.stringify(manifest, null, 2)}\n`)
  for (const [path, contents] of Object.entries(files)) {
    writeContainerFile(root, path, contents)
  }

  return root
}

export function writeContainerFile(root: string, path: string, contents: string): string {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents, 'utf8')
  return file
}

/** Removes every fixture created so far. Call it from `afterEach`. */
export function cleanupContainers(): void {
  while (created.length > 0) {
    const root = created.pop()
    if (root === undefined) continue
    rmSync(root, { recursive: true, force: true })
  }
}

/** The designated entry of a fixture container. */
export function entryOf(root: string, name = 'src/mfe.ts'): string {
  return join(root, name)
}
