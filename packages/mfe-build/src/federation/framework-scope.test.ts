import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  adapterCarriedShares,
  adapterDependencies,
  pagePolicy,
  resolveFrameworkScope,
} from './framework-scope.ts'
import { PAGE_SINGLETON, SINGLETON, type SharingPolicies } from './sharing.ts'

const created: string[] = []

afterEach(() => {
  while (created.length > 0) {
    const root = created.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

const POLICY: SharingPolicies = {
  '@acme/mfe-adapter': SINGLETON,
  '@acme/kernel': PAGE_SINGLETON,
  '@acme/kernel-runtime': PAGE_SINGLETON,
}

interface Installed {
  readonly version: string
  readonly dependencies?: Readonly<Record<string, string>>
  /** Installed beside the adapter rather than in the container, as pnpm links a dependency. */
  readonly besideAdapter?: boolean
}

/**
 * A container whose adapter's own dependencies are installed in the adapter's `node_modules`, so
 * plain resolution from the container does not find them: the layout pnpm gives a workspace.
 */
function createContainer(installed: Readonly<Record<string, Installed>>): string {
  const root = mkdtempSync(join(tmpdir(), 'mfe-scope-'))
  created.push(root)
  writeJson(join(root, 'package.json'), { name: '@acme/reports', version: '1.0.0' })

  const adapterRoot = join(root, 'node_modules/@acme/mfe-adapter')
  for (const [name, { version, dependencies, besideAdapter }] of Object.entries(installed)) {
    const base = besideAdapter === true ? adapterRoot : root
    writeJson(join(base, 'node_modules', name, 'package.json'), { name, version, dependencies })
  }
  return root
}

function writeJson(file: string, contents: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(contents, null, 2)}\n`, 'utf8')
}

describe('resolveFrameworkScope', () => {
  it('names the scope after the version the anchor resolved to', () => {
    const root = createContainer({ '@acme/ui-runtime': { version: '19.2.8' } })

    expect(resolveFrameworkScope({ framework: 'acme', anchor: '@acme/ui-runtime', root })).toBe(
      'acme@19.2.8',
    )
  })

  it('reports an anchor that is not installed, naming it and the manifest to add it to', () => {
    const root = createContainer({})

    expect(() =>
      resolveFrameworkScope({ framework: 'acme', anchor: '@acme/ui-runtime', root }),
    ).toThrowError(
      /failed to name the acme share scope: expected @acme\/ui-runtime installed.*Add @acme\/ui-runtime to the dependencies in .*package\.json/s,
    )
  })
})

describe('pagePolicy', () => {
  it('keeps only the candidates outside every framework scope', () => {
    expect(pagePolicy(POLICY)).toEqual({
      '@acme/kernel': PAGE_SINGLETON,
      '@acme/kernel-runtime': PAGE_SINGLETON,
    })
  })
})

describe('the page singletons an adapter carries', () => {
  it('are shared in the page scope at the ranges the adapter declares', () => {
    const root = createContainer({
      '@acme/mfe-adapter': {
        version: '0.1.3',
        dependencies: { '@acme/kernel': '^0.1.0', '@acme/kernel-runtime': 'workspace:*' },
      },
      '@acme/kernel': { version: '0.1.3', besideAdapter: true },
      '@acme/kernel-runtime': { version: '0.1.4', besideAdapter: true },
    })

    expect(
      adapterCarriedShares({ adapter: '@acme/mfe-adapter', containerRoot: root, policy: POLICY }),
    ).toEqual({
      '@acme/kernel': {
        singleton: true,
        strictVersion: true,
        requiredVersion: '^0.1.0',
        shareScope: 'default',
      },
      // A workspace protocol states no range, so the version beside the adapter is required.
      '@acme/kernel-runtime': {
        singleton: true,
        strictVersion: true,
        requiredVersion: '0.1.4',
        shareScope: 'default',
      },
    })
  })

  it('never include a framework-bound dependency of the adapter', () => {
    const root = createContainer({
      '@acme/mfe-adapter': {
        version: '0.1.3',
        dependencies: { '@acme/kernel': '^0.1.0', '@acme/ui-runtime': '^19.0.0' },
      },
    })
    const policy = { ...POLICY, '@acme/ui-runtime': SINGLETON }

    const carried = adapterCarriedShares({
      adapter: '@acme/mfe-adapter',
      containerRoot: root,
      policy,
    })

    expect(Object.keys(carried)).toEqual(['@acme/kernel'])
  })

  it('are none when the adapter is not installed', () => {
    const root = createContainer({})

    expect(
      adapterCarriedShares({ adapter: '@acme/mfe-adapter', containerRoot: root, policy: POLICY }),
    ).toEqual({})
    expect(adapterDependencies('@acme/mfe-adapter', root)).toBeUndefined()
  })

  it('read versions where the adapter resolves them, which plain resolution would miss', () => {
    const root = createContainer({
      '@acme/mfe-adapter': { version: '0.1.3', dependencies: { '@acme/kernel': '^0.1.0' } },
      '@acme/kernel': { version: '0.1.3', besideAdapter: true },
    })

    const adapter = adapterDependencies('@acme/mfe-adapter', root)

    expect(adapter?.dependencies).toEqual({ '@acme/kernel': '^0.1.0' })
    expect(adapter?.installedVersion('@acme/kernel')).toBe('0.1.3')
  })
})
