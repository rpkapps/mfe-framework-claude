import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { hostFederation, hostShared } from './host-shared.ts'
import { DEFAULT_SHARED_CANDIDATES } from './sharing.ts'

const created: string[] = []

afterEach(() => {
  while (created.length > 0) {
    const root = created.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

interface InstalledPackage {
  readonly version: string
  readonly dependencies?: Readonly<Record<string, string>>
}

/**
 * A host root with real packages under it, for the tests that read one. `besideAdapter` is
 * installed in the adapter's own `node_modules`, where pnpm links the adapter's dependencies, so
 * plain resolution from the host root does not find it.
 */
function createHost(
  installed: Readonly<Record<string, string | InstalledPackage>>,
  besideAdapter: Readonly<Record<string, string>> = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'mfe-runtime-'))
  created.push(root)

  writeJson(join(root, 'package.json'), { name: '@acme/shell', version: '1.0.0', private: true })
  for (const [name, entry] of Object.entries(installed)) {
    const { version, dependencies } = typeof entry === 'string' ? { version: entry } : entry
    writeJson(join(root, 'node_modules', name, 'package.json'), { name, version, dependencies })
  }
  const adapterModules = join(root, 'node_modules/@company/mfe-react/node_modules')
  for (const [name, version] of Object.entries(besideAdapter)) {
    writeJson(join(adapterModules, name, 'package.json'), { name, version })
  }

  return root
}

function writeJson(file: string, contents: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(contents, null, 2)}\n`, 'utf8')
}

const everything = () => '1.2.3'

/** Reading a version is the filesystem's job and has its own tests. */
const ROOT = '/host-root-the-resolver-never-reads'

describe('hostShared', () => {
  it('shares the framework packages, none of them as a singleton', () => {
    const shared = hostShared({
      root: ROOT,
      installedVersion: name =>
        name.startsWith('@company/') ? '0.1.0' : name === 'react' ? '19.3.0' : undefined,
    })

    expect(Object.keys(shared)).toEqual([
      '@company/mfe-core',
      '@company/mfe-runtime',
      'react',
      'react/compiler-runtime',
      'react/jsx-runtime',
    ])
    expect(shared['@company/mfe-core']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: '0.1.0',
      shareScope: 'default',
    })
    expect(shared['react']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: '19.3.0',
      shareScope: 'react@19.3.0',
    })
  })

  it('scopes every React-bound candidate by the React the host installed', () => {
    const shared = hostShared({
      root: ROOT,
      installedVersion: name => (name === 'react' || name === 'react-dom' ? '19.2.8' : '1.0.0'),
    })

    for (const [name, entry] of Object.entries(shared)) {
      const pageWide = name === '@company/mfe-core' || name === '@company/mfe-runtime'
      expect(entry.shareScope, name).toBe(pageWide ? 'default' : 'react@19.2.8')
    }
    expect(shared['react']?.requiredVersion).toBe('19.2.8')
  })

  it('reports a host that has React-bound packages but no React to name their scope by', () => {
    expect(() =>
      hostShared({
        root: ROOT,
        installedVersion: name => (name === '@tanstack/react-query' ? '5.103.1' : undefined),
      }),
    ).toThrowError(/failed to name the react share scope: expected react installed/)
  })

  it('offers every candidate the host has a copy of', () => {
    const shared = hostShared({ root: ROOT, installedVersion: everything })

    expect(Object.keys(shared).sort()).toEqual([...DEFAULT_SHARED_CANDIDATES].sort())
  })

  it('leaves out a candidate the host has no copy of', () => {
    const shared = hostShared({
      root: ROOT,
      installedVersion: name => (name === 'recharts' ? undefined : '1.2.3'),
    })

    expect(shared).not.toHaveProperty('recharts')
    expect(shared['react']?.requiredVersion).toBe('1.2.3')
  })

  it('keeps what the design system contract shares, and whether it loads eagerly', () => {
    const shared = hostShared({ root: ROOT, installedVersion: everything })

    expect(shared['react-aria-components']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: '1.2.3',
      shareScope: 'react@1.2.3',
    })
    expect(shared['recharts']?.eager).toBe(false)
    expect(shared['react']?.singleton).toBe(false)
  })

  it('does not share the design system', () => {
    const shared = hostShared({
      root: ROOT,
      installedVersion: name =>
        name === '@tecton/react' ? '0.1.0' : name === 'react' ? '19.3.0' : undefined,
    })

    expect(Object.keys(shared).filter(name => name.startsWith('@tecton/react'))).toEqual([])
  })

  it('requires the version a host installed, declared or not', () => {
    const root = createHost({ '@company/mfe-core': '0.1.0', react: '19.3.0' })

    const shared = hostShared({ root })

    expect(shared['@company/mfe-core']?.requiredVersion).toBe('0.1.0')
    expect(shared['react']?.requiredVersion).toBe('19.3.0')
    expect(shared['react']?.shareScope).toBe('react@19.3.0')
  })

  it("reads the neutral packages beside the adapter, where the adapter's own imports resolve", () => {
    const root = createHost(
      {
        react: '19.3.0',
        '@company/mfe-react': {
          version: '0.1.0',
          dependencies: { '@company/mfe-core': 'workspace:*', '@company/mfe-runtime': '^0.1.0' },
        },
      },
      { '@company/mfe-core': '0.1.3', '@company/mfe-runtime': '0.1.4' },
    )

    const shared = hostShared({ root })

    expect(shared['@company/mfe-core']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: '0.1.3',
      shareScope: 'default',
    })
    expect(shared['@company/mfe-runtime']?.requiredVersion).toBe('0.1.4')
  })

  it('never shares a package installed beside the adapter that the adapter does not declare', () => {
    const root = createHost(
      {
        react: '19.3.0',
        '@company/mfe-react': { version: '0.1.0', dependencies: { '@company/mfe-core': '^0.1.0' } },
      },
      { '@company/mfe-core': '0.1.3', sonner: '2.0.8' },
    )

    const shared = hostShared({ root })

    expect(shared).toHaveProperty('@company/mfe-core')
    expect(shared).not.toHaveProperty('sonner')
  })

  it('reports a root that resolves none of the candidates', () => {
    expect(() => hostShared({ root: ROOT, installedVersion: () => undefined })).toThrow(
      /resolved none of them/,
    )
    expect(() => hostShared({ root: ROOT, installedVersion: () => undefined })).toThrow(
      /Pass `root` the directory/,
    )
  })
})

describe('hostFederation', () => {
  it('resolves shares against the scope rather than against every registered remote', () => {
    const options = hostFederation({ root: ROOT, installedVersion: everything })

    expect(options.shareStrategy).toBe('loaded-first')
  })

  it('carries the same share scope hostShared states', () => {
    const options = hostFederation({ root: ROOT, installedVersion: everything })

    expect(options.shared).toEqual(hostShared({ root: ROOT, installedVersion: everything }))
  })
})
