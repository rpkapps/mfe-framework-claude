import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { installedVersionFrom } from './installed-version.ts'

const created: string[] = []

afterEach(() => {
  while (created.length > 0) {
    const workspace = created.pop()
    if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true })
  }
})

interface InstalledPackage {
  readonly version: string
  /**
   * Where the install put it. `'root'` is the link pnpm writes into the
   * reading package's own `node_modules`, which only a direct dependency
   * gets; `'above'` is a directory the root resolves *through*, which is
   * where everything reached indirectly actually sits.
   */
  readonly at: 'root' | 'above'
  /**
   * How much of itself the package's `exports` map lets `require` reach, which
   * is what decides which of the three lookups can answer:
   *
   * - `'everything'` publishes no map at all, so the manifest specifier works;
   * - `'the entry'` is sonner's shape — a root export and no `./package.json`;
   * - `'subpaths only'` is the design system's — neither specifier resolves.
   */
  readonly publishes?: 'everything' | 'the entry' | 'subpaths only'
  /** The file the root export points at, relative to the package. */
  readonly entry?: string
}

/**
 * Two real directories — a root, and a parent it resolves through — because
 * which lookup answers depends on what `require` does with a real `exports`
 * map. Returns the root that versions are read from; `dirname` of it is the
 * parent that `'above'` installs into.
 */
function install(packages: Readonly<Record<string, InstalledPackage>>): string {
  const workspace = mkdtempSync(join(tmpdir(), 'mfe-install-'))
  created.push(workspace)

  const root = join(workspace, 'app')
  writeJson(join(root, 'package.json'), { name: '@acme/shell', version: '1.0.0' })

  for (const [name, installed] of Object.entries(packages)) {
    const directory = join(installed.at === 'root' ? root : workspace, 'node_modules', name)
    const entry = installed.entry ?? 'index.js'

    writeJson(join(directory, 'package.json'), {
      name,
      version: installed.version,
      ...exportsMap(installed.publishes ?? 'everything', entry),
    })
    // The entry has to be a real file, or `require.resolve` refuses it.
    writeFile(join(directory, entry), 'module.exports = {}\n')
  }

  return root
}

function exportsMap(
  publishes: 'everything' | 'the entry' | 'subpaths only',
  entry: string,
): Record<string, unknown> {
  if (publishes === 'everything') return {}
  if (publishes === 'the entry') return { exports: { '.': `./${entry}` } }
  return { exports: { './federation/shared': `./${entry}` } }
}

function writeJson(file: string, contents: unknown): void {
  writeFile(file, `${JSON.stringify(contents, null, 2)}\n`)
}

function writeFile(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents, 'utf8')
}

describe('installedVersionFrom', () => {
  it('reads the version a package publishes from its own manifest', () => {
    const root = install({ react: { version: '19.3.0', at: 'above' } })

    expect(installedVersionFrom(root)('react')).toBe('19.3.0')
  })

  it('reads a version beside the entry when the exports map hides the manifest', () => {
    const root = install({ sonner: { version: '2.0.8', at: 'above', publishes: 'the entry' } })

    expect(installedVersionFrom(root)('sonner')).toBe('2.0.8')
  })

  it('reads the direct link when neither the manifest nor an entry resolves', () => {
    const root = install({
      '@tecton/react': { version: '0.1.0', at: 'root', publishes: 'subpaths only' },
    })

    expect(installedVersionFrom(root)('@tecton/react')).toBe('0.1.0')
  })

  /**
   * The walk up from a resolved entry passes every directory between it and
   * the filesystem root, so it stops at the first manifest that *names* the
   * package rather than at the first manifest it meets — a nested one marking
   * a directory's module type is not the package's own.
   */
  it('ignores a manifest that does not name the package being asked about', () => {
    const root = install({
      react: { version: '19.3.0', at: 'above', publishes: 'the entry', entry: 'dist/index.js' },
    })
    writeJson(join(dirname(root), 'node_modules/react/dist/package.json'), { type: 'module' })

    expect(installedVersionFrom(root)('react')).toBe('19.3.0')
  })

  /**
   * Not installed is an answer rather than a failure: a container turns it
   * into a share with no version requirement and a host leaves the share out,
   * and neither of those decisions belongs here.
   */
  it('answers undefined for a package that is not installed', () => {
    const root = install({})

    expect(installedVersionFrom(root)('@acme/never-installed')).toBeUndefined()
  })

  it('answers undefined for a manifest that is not readable JSON', () => {
    const root = install({})
    writeFile(join(root, 'node_modules/broken/package.json'), '{ not json')

    expect(installedVersionFrom(root)('broken')).toBeUndefined()
  })
})
