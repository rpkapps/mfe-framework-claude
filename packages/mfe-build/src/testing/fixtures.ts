/** Discovery and generation work on real files, so the tests give them real files. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const created: string[] = []

/** Writes a container into a temporary directory and returns its root. */
export function createContainer(
  files: Readonly<Record<string, string>>,
  options: { readonly manifest?: Record<string, unknown> } = {},
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
