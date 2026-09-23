import { readJson, readProjectConfiguration, type Tree } from '@nx/devkit'
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import { commandOf, readTreeFile } from '../../testing/tree-helpers.ts'
import widgetGenerator from './generator.ts'

let tree: Tree

beforeEach(() => {
  tree = createTreeWithEmptyWorkspace()
})

describe('the widget generator', () => {
  it('writes every file the Widget template inventory promises', async () => {
    await widgetGenerator(tree, { name: 'alert-panel', skipFormat: true })

    const expected = [
      'apps/alert-panel/project.json',
      'apps/alert-panel/package.json',
      'apps/alert-panel/rspack.config.ts',
      'apps/alert-panel/src/main.ts',
      'apps/alert-panel/src/index.html',
      'apps/alert-panel/src/styles.css',
      'apps/alert-panel/src/mfe.ts',
      'apps/alert-panel/src/alert-panel.component.ts',
      'apps/alert-panel/src/alert-panel.component.spec.ts',
      'apps/alert-panel/tsconfig.json',
      'apps/alert-panel/tsconfig.app.json',
      'apps/alert-panel/tsconfig.spec.json',
      'apps/alert-panel/vitest.config.mts',
      'apps/alert-panel/vitest.setup.ts',
      'apps/alert-panel/.gitignore',
      'apps/alert-panel/README.md',
    ]

    for (const path of expected) {
      expect(tree.exists(path), path).toBe(true)
    }
  })

  it('declares no routes and no App-only files', async () => {
    await widgetGenerator(tree, { name: 'alert-panel', skipFormat: true })

    expect(tree.exists('apps/alert-panel/src/app.routes.ts')).toBe(false)
    expect(tree.exists('apps/alert-panel/src/mfe.config.ts')).toBe(false)
    expect(tree.exists('apps/alert-panel/public/runtime-config.json')).toBe(false)

    const entry = readTreeFile(tree, 'apps/alert-panel/src/mfe.ts')
    expect(entry).not.toContain('routes')
  })

  it('exports the contract separately, with a component whose members match it', async () => {
    await widgetGenerator(tree, { name: 'alert-panel', skipFormat: true })

    const entry = readTreeFile(tree, 'apps/alert-panel/src/mfe.ts')
    expect(entry).toContain("import { createWidget } from '@company/mfe-angular'")
    expect(entry).toContain('export const alertPanelContract')
    expect(entry).toContain("id: 'alert-panel'")
    expect(entry).toContain('...alertPanelContract')
    expect(entry).toContain('component: AlertPanelComponent')

    const component = readTreeFile(tree, 'apps/alert-panel/src/alert-panel.component.ts')
    expect(component).toContain('export class AlertPanelComponent')
    expect(component).toContain('input.required<string>()')
    expect(component).toContain('output<{ at: string }>()')
  })

  it("publishes the generated contract module at the package's own contracts export", async () => {
    await widgetGenerator(tree, { name: 'alert-panel', skipFormat: true })

    const pkg = readJson<{ exports: Record<string, string> }>(tree, 'apps/alert-panel/package.json')
    expect(pkg.exports['./contracts']).toBe('./.mfe/widgets/alert-panel.contract.ts')
  })

  it('defaults the port to 3103, distinct from an App', async () => {
    await widgetGenerator(tree, { name: 'alert-panel', skipFormat: true })

    const pkg = readJson<{ mfe: { port: number } }>(tree, 'apps/alert-panel/package.json')
    expect(pkg.mfe.port).toBe(3103)
  })

  it('rejects an id that cannot serve as a storage prefix and a scope value', async () => {
    await expect(
      widgetGenerator(tree, { name: 'alert-panel', id: 'Not Valid', skipFormat: true }),
    ).rejects.toThrowError(/not a usable definition id/)
  })

  it('skips adding dependencies to the workspace package.json when skipPackageJson is set', async () => {
    await widgetGenerator(tree, { name: 'alert-panel', skipPackageJson: true, skipFormat: true })

    const root = readJson<{ dependencies: Record<string, string> }>(tree, 'package.json')
    expect(root.dependencies).not.toHaveProperty('@company/mfe-angular')
  })

  it('registers the Nx project under the given name', async () => {
    await widgetGenerator(tree, { name: 'alert-panel', skipFormat: true })

    const project = readProjectConfiguration(tree, 'alert-panel')
    expect(project.root).toBe('apps/alert-panel')
    expect(commandOf(project, 'test')).toBe('mfe-generate && vitest run')
  })
})
