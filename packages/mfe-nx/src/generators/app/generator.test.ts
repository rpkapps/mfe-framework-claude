import { readJson, readProjectConfiguration, updateJson, type Tree } from '@nx/devkit'
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import { commandOf, readTreeFile } from '../../testing/tree-helpers.ts'
import appGenerator from './generator.ts'

let tree: Tree

beforeEach(() => {
  tree = createTreeWithEmptyWorkspace()
})

describe('the app generator', () => {
  it('writes every file the App template inventory promises', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const expected = [
      'apps/operations/project.json',
      'apps/operations/package.json',
      'apps/operations/public/runtime-config.json',
      'apps/operations/rspack.config.ts',
      'apps/operations/src/main.ts',
      'apps/operations/src/index.html',
      'apps/operations/src/styles.css',
      'apps/operations/src/mfe.ts',
      'apps/operations/src/mfe.config.ts',
      'apps/operations/src/app.routes.ts',
      'apps/operations/src/overview.component.ts',
      'apps/operations/src/overview.component.spec.ts',
      'apps/operations/src/settings.component.ts',
      'apps/operations/tsconfig.json',
      'apps/operations/tsconfig.app.json',
      'apps/operations/tsconfig.spec.json',
      'apps/operations/vitest.config.mts',
      'apps/operations/vitest.setup.ts',
      'apps/operations/.gitignore',
      'apps/operations/README.md',
    ]

    for (const path of expected) {
      expect(tree.exists(path), path).toBe(true)
    }

    // A Widget-only file has no business in an App.
    expect(tree.exists('apps/operations/src/mfe.ts.template')).toBe(false)
  })

  it("creates a definition whose id and routes match the project's own", async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const entry = readTreeFile(tree, 'apps/operations/src/mfe.ts')
    expect(entry).toContain("import { createApp } from '@company/mfe-angular'")
    expect(entry).toContain("id: 'operations'")
    expect(entry).toContain("version: '0.1.0'")
    expect(entry).toContain('routes,')

    const routes = readTreeFile(tree, 'apps/operations/src/app.routes.ts')
    expect(routes).toContain("path: 'settings'")
    expect(routes).toContain("capability: 'settings'")
    expect(routes).toContain("label: 'operations settings'")
  })

  it('wires rspack.config.ts through withMfe over an ordinary Angular-Rspack config', async () => {
    await appGenerator(tree, { name: 'operations', port: 4001, skipFormat: true })

    const config = readTreeFile(tree, 'apps/operations/rspack.config.ts')
    expect(config).toContain("import { createConfig } from '@nx/angular-rspack'")
    expect(config).toContain("import { withMfe } from '@company/mfe-rspack/rspack'")
    expect(config).toContain("browser: './src/main.ts'")
    expect(config).toContain('polyfills: []')
    expect(config).toContain('devServer: { port: 4001 }')
  })

  it('registers an nx:run-commands project with the generate-first targets', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const project = readProjectConfiguration(tree, 'operations')
    expect(project.root).toBe('apps/operations')
    expect(commandOf(project, 'build')).toBe('mfe-generate && rspack build --mode production')
    expect(project.targets?.['build']?.dependsOn).toEqual(['^build'])
    expect(project.targets?.['build']?.outputs).toEqual(['{projectRoot}/dist'])
    expect(commandOf(project, 'serve')).toBe('mfe-generate && rspack serve')
    expect(commandOf(project, 'generate')).toBe('mfe-generate')
  })

  it("gives the project its own manifest with the port and the definition's id", async () => {
    await appGenerator(tree, { name: 'operations', port: 4001, skipFormat: true })

    const pkg = readJson<{
      name: string
      mfe: { port: number; definitions: string[] }
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }>(tree, 'apps/operations/package.json')

    expect(pkg.name).toBe('@example/operations')
    expect(pkg.mfe).toEqual({ port: 4001, definitions: ['operations'] })
    expect(pkg.dependencies['@company/mfe-angular']).toBeDefined()
    expect(pkg.devDependencies['@nx/angular-rspack']).toBe('22.7.12')
    // An App never publishes a contract: only a Widget does.
    expect(pkg).not.toHaveProperty('exports')
  })

  it('writes the runtime config its own #mfe/config fetches at boot', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const config = readJson<{ apiBaseUrl: string }>(
      tree,
      'apps/operations/public/runtime-config.json',
    )
    expect(config.apiBaseUrl).toMatch(/^https?:\/\//)
  })

  it('rejects an id that cannot serve as a storage prefix and a scope value', async () => {
    await expect(
      appGenerator(tree, { name: 'operations', id: 'Not Valid', skipFormat: true }),
    ).rejects.toThrowError(/not a usable definition id/)
  })

  it('defaults the id to the kebab-cased project name and the port to 3101', async () => {
    await appGenerator(tree, { name: 'Field Ops', skipFormat: true })

    const project = readProjectConfiguration(tree, 'field-ops')
    expect(project.root).toBe('apps/field-ops')

    const pkg = readJson<{ mfe: { port: number; definitions: string[] } }>(
      tree,
      'apps/field-ops/package.json',
    )
    expect(pkg.mfe.port).toBe(3101)
    expect(pkg.mfe.definitions).toEqual(['field-ops'])
  })

  it('defaults the directory and package name, and accepts overrides for both', async () => {
    await appGenerator(tree, {
      name: 'operations',
      directory: 'containers/operations',
      packageName: '@acme/operations',
      skipFormat: true,
    })

    expect(tree.exists('containers/operations/project.json')).toBe(true)
    const pkg = readJson<{ name: string }>(tree, 'containers/operations/package.json')
    expect(pkg.name).toBe('@acme/operations')
  })

  it('skips adding dependencies to the workspace package.json when skipPackageJson is set', async () => {
    await appGenerator(tree, { name: 'operations', skipPackageJson: true, skipFormat: true })

    const root = readJson<{ dependencies: Record<string, string> }>(tree, 'package.json')
    expect(root.dependencies).not.toHaveProperty('@company/mfe-angular')

    // The project's own manifest still declares what it needs; only the workspace-level install
    // step is skipped.
    const pkg = readJson<{ dependencies: Record<string, string> }>(
      tree,
      'apps/operations/package.json',
    )
    expect(pkg.dependencies['@company/mfe-angular']).toBeDefined()
  })

  it('adds the workspace dependencies by default', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const root = readJson<{
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }>(tree, 'package.json')
    expect(root.dependencies['@company/mfe-angular']).toBeDefined()
    expect(root.devDependencies['@nx/angular-rspack']).toBeDefined()
  })

  it('picks the @nx/angular-rspack line matching the workspace Nx major', async () => {
    updateJson(tree, 'package.json', (json: Record<string, unknown>) => ({
      ...json,
      devDependencies: { ...(json['devDependencies'] as object), nx: '^21.5.0' },
    }))

    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const pkg = readJson<{ devDependencies: Record<string, string> }>(
      tree,
      'apps/operations/package.json',
    )
    expect(pkg.devDependencies['@nx/angular-rspack']).toBe('21.6.5')
  })
})
