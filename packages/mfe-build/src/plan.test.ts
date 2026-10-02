import { rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as TsAst from './discovery/ts-ast.ts'
import { parseSourceFile } from './discovery/ts-ast.ts'
import { createContainerPlanner } from './plan.ts'
import { cleanupContainers, createContainer } from './testing/fixtures.ts'
import { TEST_FRAMEWORK_ANCHOR, TEST_PROFILE } from './testing/profile.ts'

vi.mock('./discovery/ts-ast.ts', async importOriginal => {
  const original = await importOriginal<typeof TsAst>()
  return { ...original, parseSourceFile: vi.fn(original.parseSourceFile) }
})

afterEach(cleanupContainers)

const parsed = vi.mocked(parseSourceFile)

const CONTAINER = {
  'src/mfe.ts': `
import { createApp } from '@acme/mfe-adapter'
import { routes } from './routes.ts'

export const operations = createApp({ id: 'operations', routes })
`,
  'src/routes.ts': 'export const routes = []\n',
  // Mentions the adapter, so stray detection has to look inside.
  'src/panel.ts': "import { useThing } from '@acme/mfe-adapter'\nexport const panel = useThing\n",
  // Mentions an asset, so the asset scan has to look inside.
  'src/logo.ts': "export const logo = new URL('./logo.svg', import.meta.url).href\n",
  'src/format.ts': 'export const format = (value: number) => value.toFixed(2)\n',
}

/** The container files each plan parsed, relative to its root, in the order it parsed them. */
function parsesOf(root: string, plan: () => unknown): readonly string[] {
  parsed.mockClear()
  plan()
  return parsed.mock.calls.map(([file]) => relative(root, file))
}

describe('a planner', () => {
  it('updates every definition and artifact when only the package version changes', () => {
    const root = createContainer({
      ...CONTAINER,
      'src/mfe.ts': `import packageJson from '../package.json'\n${CONTAINER['src/mfe.ts'].replace(
        "id: 'operations', routes",
        "id: 'operations', version: packageJson.version, routes",
      )}
import { createWidget } from '@acme/mfe-adapter'
import { z } from 'zod'
export const row = createWidget({
  id: 'row', version: packageJson.version,
  inputSchema: z.object({}), outputSchema: z.object({}), render: () => null,
})`,
    })
    const plan = createContainerPlanner(TEST_PROFILE, { containerRoot: root })
    plan()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '2.0.0' }))
    const second = plan()

    expect(second.discovery.definitions.map(definition => definition.version)).toEqual([
      '2.0.0',
      '2.0.0',
    ])
    expect(second.generated.descriptor.definitions.map(definition => definition.version)).toEqual([
      '2.0.0',
      '2.0.0',
    ])
    expect(
      second.generated.frameworkMetadata.definitions.map(definition => definition.version),
    ).toEqual(['2.0.0', '2.0.0'])
    expect(second.generated.files.find(file => file.path.endsWith('/meta.ts'))?.contents).toContain(
      "version: '2.0.0'",
    )
  })

  it('parses each source a plan needs once, and a source nothing needs never', () => {
    const root = createContainer(CONTAINER)
    const plan = createContainerPlanner(TEST_PROFILE, { containerRoot: root })

    expect([...parsesOf(root, plan)].sort()).toEqual(['src/logo.ts', 'src/mfe.ts', 'src/panel.ts'])
  })

  it('parses nothing again while the sources are unchanged', () => {
    const root = createContainer(CONTAINER)
    const plan = createContainerPlanner(TEST_PROFILE, { containerRoot: root })
    plan()

    expect(parsesOf(root, plan)).toEqual([])
  })

  it('parses only the source that changed, and plans from its new text', () => {
    const root = createContainer(CONTAINER)
    const plan = createContainerPlanner(TEST_PROFILE, { containerRoot: root })
    plan()

    writeFileSync(
      join(root, 'src/mfe.ts'),
      CONTAINER['src/mfe.ts'].replace("'operations'", "'orders'"),
    )

    expect(parsesOf(root, plan)).toEqual(['src/mfe.ts'])
    expect(plan().discovery.definitions.map(definition => definition.id)).toEqual(['orders'])
  })

  it('reads the manifest and resolves the shares once, as a restart would', () => {
    const root = createContainer(CONTAINER)
    const plan = createContainerPlanner(TEST_PROFILE, { containerRoot: root })
    const first = plan()

    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@acme/renamed' }))
    rmSync(join(root, 'node_modules', TEST_FRAMEWORK_ANCHOR), { recursive: true })
    const second = plan()

    expect(second.options.packageName).toBe(first.options.packageName)
    expect(second.shared).toBe(first.shared)
    expect(second.generated.descriptor.shareScopes).toEqual(first.generated.descriptor.shareScopes)
  })
})
