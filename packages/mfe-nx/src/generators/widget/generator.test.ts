import { readJson, readProjectConfiguration, type Tree } from '@nx/devkit'
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import { optionsOf, readTreeFile, readTreeFiles, targetOf } from '../../testing/tree-helpers.ts'
import widgetGenerator from './generator.ts'

let tree: Tree

beforeEach(() => {
  tree = createTreeWithEmptyWorkspace()
})

describe('the widget generator', () => {
  it('writes every file the Widget template inventory promises', async () => {
    await widgetGenerator(tree, { name: 'alert-panel', skipFormat: true })

    const expected = [
      'project.json',
      'package.json',
      'webpack.config.ts',
      'src/index.html',
      'src/styles.css',
      'src/primeng.ts',
      'src/mfe.ts',
      'src/alert-panel.component.ts',
      'src/alert-panel.component.spec.ts',
      'tsconfig.json',
      'tsconfig.app.json',
      'tsconfig.spec.json',
      'vitest.config.mts',
      'vitest.setup.ts',
      '.gitignore',
      'README.md',
    ]

    expect([...readTreeFiles(tree, 'apps/alert-panel').keys()].sort()).toEqual(
      expected.map(path => `apps/alert-panel/${path}`).sort(),
    )
  })

  it('declares no routes, no configuration and no public directory', async () => {
    await widgetGenerator(tree, { name: 'alert-panel', skipFormat: true })

    expect(readTreeFile(tree, 'apps/alert-panel/src/mfe.ts')).not.toContain('routes')
    expect(tree.exists('apps/alert-panel/public/runtime-config.json')).toBe(false)
  })

  it('exports the contract separately, with a component whose members match it', async () => {
    await widgetGenerator(tree, { name: 'alert-panel', skipFormat: true })

    const entry = readTreeFile(tree, 'apps/alert-panel/src/mfe.ts')
    expect(entry).toContain("import { createWidget } from '@company/mfe-angular'")
    expect(entry).toContain('export const alertPanelContract')
    expect(entry).toContain("id: 'alert-panel'")
    expect(entry).toContain('...alertPanelContract')
    expect(entry).toContain('component: AlertPanelComponent')
    expect(entry).toContain('providers: [providePrimeNgForMfe()]')

    const component = readTreeFile(tree, 'apps/alert-panel/src/alert-panel.component.ts')
    expect(component).toContain('export class AlertPanelComponent')
    expect(component).toContain('input.required<string>()')
    expect(component).toContain('output<{ at: string }>()')
  })

  it('renders a PrimeNG button and binds its dark mode from the component the mount renders', async () => {
    await widgetGenerator(tree, { name: 'alert-panel', skipFormat: true })

    const component = readTreeFile(tree, 'apps/alert-panel/src/alert-panel.component.ts')
    expect(component).toContain("import { Button } from 'primeng/button'")
    expect(component).toContain('<p-button [label]="label()" (onClick)="activate()" />')
    expect(component).toMatch(/constructor\(\) \{\s+bindPrimeNgDarkModeToShell\(\)\s+\}/)

    const readme = readTreeFile(tree, 'apps/alert-panel/README.md')
    expect(readme).toContain('Dialog, ConfirmDialog and Drawer do not')
    expect(readme).toContain('same\n  PrimeNG version and the same preset')
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
    expect(optionsOf(readProjectConfiguration(tree, 'alert-panel'), 'serve')['port']).toBe(3103)
  })

  it('builds and serves exactly as an App does', async () => {
    await widgetGenerator(tree, { name: 'alert-panel', skipFormat: true })

    const project = readProjectConfiguration(tree, 'alert-panel')
    expect(project.projectType).toBe('library')
    expect(targetOf(project, 'build').executor).toBe('@nx/angular:webpack-browser')
    expect(targetOf(project, 'serve').executor).toBe('@nx/angular:dev-server')
    expect(targetOf(project, 'generate').executor).toBe('@company/mfe-nx:generate')
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
})
