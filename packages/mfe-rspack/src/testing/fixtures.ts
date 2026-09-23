/** Discovery and generation work on real files, so the tests give them real files. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const created: string[] = []

export interface ContainerFixtureOptions {
  readonly manifest?: Record<string, unknown>
  /**
   * Package versions installed into the container's `node_modules`, as manifests only. Defaults
   * to React, whose version names the container's share scope.
   */
  readonly installed?: Readonly<Record<string, string>>
}

const REACT_INSTALLED: Readonly<Record<string, string>> = { react: '19.3.0' }

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
  for (const [name, version] of Object.entries(options.installed ?? REACT_INSTALLED)) {
    writeContainerFile(
      root,
      `node_modules/${name}/package.json`,
      `${JSON.stringify({ name, version }, null, 2)}\n`,
    )
  }

  return root
}

function writeContainerFile(root: string, path: string, contents: string): string {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents, 'utf8')
  return file
}

/** Removes every fixture created so far; call it from `afterEach`. */
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
