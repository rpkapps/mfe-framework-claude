import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { hostShared } from './host-shared.ts'
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

/** A host that has a copy of everything, all of it on one version. */
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

  /**
   * Asserted against the candidate list rather than against names repeated
   * here, because half of it is the design system's to state: a candidate
   * added to its published contract has to reach a host without an edit in
   * this repository, which is the whole reason a host does not keep a list.
   */
  it('offers every candidate the host has a copy of', () => {
    const shared = hostShared({ root: ROOT, installedVersion: everything })

    expect(Object.keys(shared).sort()).toEqual([...DEFAULT_SHARED_CANDIDATES].sort())
  })

  /**
   * A design system dependency only a charting container pulls in has no copy
   * on the host to offer, so advertising it would promise a module the share
   * scope cannot serve.
   */
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

  /**
   * Module Federation reads a share's version from the package's own manifest,
   * and no package is literally named `@tecton/react/`, so the prefix share is
   * the one entry that has to state its version as well as require it.
   */
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

  /**
   * A host provides these modules rather than consuming them, so what it
   * advertises is the copy it is putting into the scope. It also shares what
   * it resolves rather than what it declares: `@company/mfe-core` reaches a
   * shell through the adapter and appears in no shell's dependencies, while
   * being exactly the package whose second copy makes every framework hook
   * fail.
   */
  it('requires the version a host installed, declared or not', () => {
    const root = createHost({ '@company/mfe-core': '0.1.0', react: '19.3.0' })

    const shared = hostShared({ root })

    expect(shared['@company/mfe-core']?.requiredVersion).toBe('0.1.0')
    expect(shared['react']?.requiredVersion).toBe('19.3.0')
  })

  /**
   * A root that resolves nothing is a wrong path, not a host that shares
   * nothing: the scope would come back empty and every remote would quietly
   * load its own React, which is the failure the share scope exists to
   * prevent.
   */
  it('reports a root that resolves none of the candidates', () => {
    expect(() => hostShared({ root: ROOT, installedVersion: () => undefined })).toThrow(
      /resolved none of them/,
    )
    expect(() => hostShared({ root: ROOT, installedVersion: () => undefined })).toThrow(
      /hostShared\(\{ root \}\)/,
    )
  })
})
