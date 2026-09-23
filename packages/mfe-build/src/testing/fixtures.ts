/** Discovery and generation work on real files, so the tests give them real files. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { TEST_FRAMEWORK_ANCHOR } from './profile.ts'

const created: string[] = []

export interface InstalledFixturePackage {
  readonly version: string
  readonly dependencies?: Readonly<Record<string, string>>
}

export interface ContainerFixtureOptions {
  readonly manifest?: Record<string, unknown>
  /**
   * Packages installed into the container's `node_modules`, as manifests only. Defaults to the
   * made-up framework's anchor, so the container has a framework share scope.
   */
  readonly installed?: Readonly<Record<string, InstalledFixturePackage>>
}

const FRAMEWORK_INSTALLED: Readonly<Record<string, InstalledFixturePackage>> = {
  [TEST_FRAMEWORK_ANCHOR]: { version: '19.3.0' },
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
    dependencies: { '@acme/mfe-adapter': '^1.0.0' },
    ...options.manifest,
  }

  writeContainerFile(root, 'package.json', `${JSON.stringify(manifest, null, 2)}\n`)
  for (const [path, contents] of Object.entries(files)) {
    writeContainerFile(root, path, contents)
  }
  for (const [name, installed] of Object.entries(options.installed ?? FRAMEWORK_INSTALLED)) {
    const manifestJson = { name, version: installed.version, dependencies: installed.dependencies }
    writeContainerFile(
      root,
      `node_modules/${name}/package.json`,
      `${JSON.stringify(manifestJson, null, 2)}\n`,
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
