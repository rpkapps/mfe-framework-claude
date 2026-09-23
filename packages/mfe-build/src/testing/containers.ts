/**
 * Discovery, generation and the bundler plugins work on real files, so every integration's tests
 * give them a real container in a temporary directory. What one looks like by default is the
 * integration's to say; writing and removing them is the same everywhere.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const created: string[] = []

export interface InstalledFixturePackage {
  readonly version: string
  readonly dependencies?: Readonly<Record<string, string>>
}

export interface ContainerFixture {
  /** The container's whole `package.json`. */
  readonly manifest: Readonly<Record<string, unknown>>
  /** Packages installed into the container's `node_modules`, as manifests only. */
  readonly installed?: Readonly<Record<string, InstalledFixturePackage>>
}

/** Writes a container into a temporary directory and returns its root. */
export function createContainerFixture(
  files: Readonly<Record<string, string>>,
  fixture: ContainerFixture,
): string {
  const root = mkdtempSync(join(tmpdir(), 'mfe-container-'))
  created.push(root)

  writeJsonFile(root, 'package.json', fixture.manifest)
  for (const [path, contents] of Object.entries(files)) writeFile(root, path, contents)
  for (const [name, installed] of Object.entries(fixture.installed ?? {})) {
    writeJsonFile(root, `node_modules/${name}/package.json`, {
      name,
      version: installed.version,
      dependencies: installed.dependencies,
    })
  }

  return root
}

/** Writes one file of a container, relative to its root, and returns its absolute path. */
export function writeFile(root: string, path: string, contents: string): string {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents, 'utf8')
  return file
}

/** Two-space JSON with a trailing newline, the way a package manager writes a manifest. */
export function writeJsonFile(root: string, path: string, value: unknown): string {
  return writeFile(root, path, `${JSON.stringify(value, null, 2)}\n`)
}

/** Removes every fixture created so far; call it from `afterEach`. */
export function cleanupContainers(): void {
  while (created.length > 0) {
    const root = created.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
}

/** The designated entry of a fixture container. */
export function entryOf(root: string, name = 'src/mfe.ts'): string {
  return join(root, name)
}
