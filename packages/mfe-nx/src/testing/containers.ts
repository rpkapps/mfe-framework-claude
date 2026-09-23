/**
 * Discovery, generation and the webpack build work on real files, so the tests give them a real
 * container: a manifest, sources, and a `node_modules` holding the adapter packages as small
 * stand-ins, beside links to the real packages a build resolves (Zod, Tailwind).
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const created: string[] = []

const ANGULAR_CORE = '@angular/core'

/** The Angular version every fixture container is built on, unless a test links a real one. */
export const ANGULAR_CORE_VERSION = '19.2.25'

/** This package's own `node_modules`, where the real packages a fixture links to are installed. */
const INSTALLED = join(__dirname, '../../node_modules')

export interface ContainerFixtureOptions {
  /** Merged over a manifest that depends on the Angular adapter. */
  readonly manifest?: Readonly<Record<string, unknown>>
  /** Real packages to link into the fixture's `node_modules`. */
  readonly link?: readonly string[]
}

/** Writes a container into a temporary directory and returns its root. */
export function createContainer(
  files: Readonly<Record<string, string>>,
  options: ContainerFixtureOptions = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'mfe-nx-container-'))
  created.push(root)

  writeJsonFile(root, 'package.json', {
    name: '@acme/reports',
    version: '1.2.0',
    type: 'module',
    dependencies: { '@company/mfe-angular': '^0.1.0', rxjs: '^7.8.0' },
    ...options.manifest,
  })
  for (const [path, contents] of Object.entries(files)) writeFile(root, path, contents)

  installAdapter(root)
  // Its version names the container's Angular share scope; a test that links the real one uses that.
  if (!(options.link ?? []).includes(ANGULAR_CORE)) {
    writePackage(root, ANGULAR_CORE, ANGULAR_CORE_VERSION, {}, 'export const VERSION = {}\n')
  }
  for (const name of options.link ?? []) {
    const target = join(root, 'node_modules', name)
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(join(INSTALLED, name), target, 'dir')
  }

  return root
}

/**
 * The adapter as a container resolves it: a package depending on the neutral core and runtime,
 * which it imports, so a build sees the requests the real adapter makes.
 */
function installAdapter(root: string): void {
  writePackage(root, '@company/mfe-core', '0.1.3', {}, 'export const HOST_SCOPE = "@host"\n')
  writePackage(
    root,
    '@company/mfe-runtime',
    '0.1.3',
    {},
    'export const MOUNT_ATTRIBUTE = "data-mfe-mount"\n',
  )
  writePackage(
    root,
    '@company/mfe-angular',
    '0.1.3',
    { '@company/mfe-core': '^0.1.0', '@company/mfe-runtime': '^0.1.0' },
    [
      "import { HOST_SCOPE } from '@company/mfe-core'",
      "import { MOUNT_ATTRIBUTE } from '@company/mfe-runtime'",
      'export const createApp = options => ({ ...options, kind: "app", scope: HOST_SCOPE })',
      'export const createWidget = options => ({ ...options, kind: "widget", attribute: MOUNT_ATTRIBUTE })',
      'export const mfeRouteData = data => data',
      'export const createContainerTransport = () => ({ fetch: globalThis.fetch, getAccessToken: async () => null })',
      '',
    ].join('\n'),
  )
}

function writePackage(
  root: string,
  name: string,
  version: string,
  dependencies: Readonly<Record<string, string>>,
  source: string,
): void {
  const directory = join('node_modules', name)
  writeJsonFile(root, join(directory, 'package.json'), {
    name,
    version,
    type: 'module',
    exports: { '.': './index.js', './package.json': './package.json' },
    dependencies,
  })
  writeFile(root, join(directory, 'index.js'), source)
}

export function writeFile(root: string, path: string, contents: string): string {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents, 'utf8')
  return file
}

function writeJsonFile(root: string, path: string, value: unknown): void {
  writeFile(root, path, `${JSON.stringify(value, null, 2)}\n`)
}

/** Removes every fixture created so far; call it from `afterEach`. */
export function cleanupContainers(): void {
  while (created.length > 0) {
    const root = created.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
}
