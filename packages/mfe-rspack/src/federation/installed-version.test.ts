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
  /** `'root'` is pnpm's link for a direct dependency; `'above'` is a directory resolved through. */
  readonly at: 'root' | 'above'
  /** How much of itself the `exports` map lets `require` reach, which decides the lookup. */
  readonly publishes?: 'everything' | 'the entry' | 'subpaths only'
  /** The file the root export points at, relative to the package. */
  readonly entry?: string
}

/** Real directories, because which lookup answers depends on a real `exports` map. */
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

  it('ignores a manifest that does not name the package being asked about', () => {
    const root = install({
      react: { version: '19.3.0', at: 'above', publishes: 'the entry', entry: 'dist/index.js' },
    })
    writeJson(join(dirname(root), 'node_modules/react/dist/package.json'), { type: 'module' })

    expect(installedVersionFrom(root)('react')).toBe('19.3.0')
  })

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
