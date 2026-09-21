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

/** A host root with real packages under it, for the one test that reads one. */
function createHost(installed: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'mfe-host-'))
  created.push(root)

  writeJson(join(root, 'package.json'), { name: '@acme/shell', version: '1.0.0', private: true })
  for (const [name, version] of Object.entries(installed)) {
    writeJson(join(root, 'node_modules', name, 'package.json'), { name, version })
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
  it('shares the framework packages as strict singletons', () => {
    const shared = hostShared({
      root: ROOT,
      installedVersion: name => (name.startsWith('@company/') ? '0.1.0' : undefined),
    })

    expect(Object.keys(shared)).toEqual([
      '@company/mfe-core',
      '@company/mfe-host',
      '@company/mfe-react',
    ])
    expect(shared['@company/mfe-core']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '0.1.0',
    })
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

  it('keeps the design system contract as the contract states it', () => {
    const shared = hostShared({ root: ROOT, installedVersion: everything })

    expect(shared['react-aria-components']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: '1.2.3',
    })
    expect(shared['recharts']?.eager).toBe(false)
    expect(shared['react']?.singleton).toBe(true)
  })

  it('states the version on the design system prefix share', () => {
    const shared = hostShared({
      root: ROOT,
      installedVersion: name => (name === '@tecton/react' ? '0.1.0' : undefined),
    })

    expect(shared['@tecton/react/']).toEqual({
      singleton: false,
      strictVersion: false,
      requiredVersion: '0.1.0',
      version: '0.1.0',
    })
  })

  it('requires the version a host installed, declared or not', () => {
    const root = createHost({ '@company/mfe-core': '0.1.0', react: '19.3.0' })

    const shared = hostShared({ root })

    expect(shared['@company/mfe-core']?.requiredVersion).toBe('0.1.0')
    expect(shared['react']?.requiredVersion).toBe('19.3.0')
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
