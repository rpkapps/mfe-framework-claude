import { logger, readJson, readProjectConfiguration, updateJson, type Tree } from '@nx/devkit'
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  commandOf,
  configurationOf,
  optionsOf,
  readTreeFile,
  readTreeFiles,
  targetOf,
} from '../../testing/tree-helpers.ts'
import appGenerator from './generator.ts'

let tree: Tree

beforeEach(() => {
  tree = createTreeWithEmptyWorkspace()
})

afterEach(() => {
  vi.restoreAllMocks()
})

interface ProjectManifest {
  readonly name: string
  readonly mfe: { readonly port: number; readonly definitions: readonly string[] }
  readonly scripts?: unknown
  readonly exports?: unknown
  readonly dependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
}

function setWorkspaceDevDependency(name: string, version: string): void {
  updateJson(tree, 'package.json', (json: Record<string, unknown>) => ({
    ...json,
    devDependencies: { ...(json['devDependencies'] as object), [name]: version },
  }))
}

describe('the app generator', () => {
  it('writes every file the App template inventory promises', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const expected = [
      'project.json',
      'package.json',
      'public/runtime-config.json',
      'webpack.config.ts',
      'src/index.html',
      'src/styles.css',
      'src/primeng.ts',
      'src/mfe.ts',
      'src/mfe.config.ts',
      'src/app.component.ts',
      'src/app.routes.ts',
      'src/overview.component.ts',
      'src/overview.component.spec.ts',
      'src/settings.component.ts',
      'tsconfig.json',
      'tsconfig.app.json',
      'tsconfig.spec.json',
      'vitest.config.mts',
      'vitest.setup.ts',
      '.gitignore',
      'README.md',
    ]

    expect([...readTreeFiles(tree, 'apps/operations').keys()].sort()).toEqual(
      expected.map(path => `apps/operations/${path}`).sort(),
    )
  })

  it('writes no Rspack configuration, no application bootstrap and no lint configuration', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    for (const [path, contents] of readTreeFiles(tree, 'apps/operations')) {
      expect(contents, path).not.toMatch(/rspack/i)
      expect(contents, path).not.toMatch(/from 'zone\.js'|import 'zone\.js'/)
    }
    expect(tree.exists('apps/operations/src/main.ts')).toBe(false)
    expect(tree.exists('apps/operations/eslint.config.ts')).toBe(false)
  })

  it("creates a definition whose id, routes, root component and PrimeNG providers are the project's own", async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const entry = readTreeFile(tree, 'apps/operations/src/mfe.ts')
    expect(entry).toContain("import { createApp } from '@company/mfe-angular'")
    expect(entry).toContain("id: 'operations'")
    expect(entry).toContain("version: '0.1.0'")
    expect(entry).toContain('routes,')
    expect(entry).toContain('component: AppComponent,')
    expect(entry).toContain('providers: [providePrimeNgForMfe()]')

    const routes = readTreeFile(tree, 'apps/operations/src/app.routes.ts')
    expect(routes).toContain("path: 'settings'")
    expect(routes).toContain('data: mfeRouteData({')
    expect(routes).toContain("capability: 'settings'")
    expect(routes).toContain("label: 'operations settings'")
  })

  it('binds PrimeNG dark mode to the shell from the root component the mount renders', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const root = readTreeFile(tree, 'apps/operations/src/app.component.ts')
    expect(root).toContain("template: '<router-outlet />'")
    expect(root).toMatch(/constructor\(\) \{\s+bindPrimeNgDarkModeToShell\(\)\s+\}/)
  })

  it('scaffolds the PrimeNG integration against the mount, zoneless', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const primeng = readTreeFile(tree, 'apps/operations/src/primeng.ts')
    expect(primeng).toContain('provideNoopAnimations()')
    expect(primeng).toContain("import Aura from '@primeng/themes/aura'")
    expect(primeng).toContain('darkModeSelector: `.${PRIMENG_DARK_CLASS}`')
    expect(primeng).toContain('appendTo: mount.overlayRoot')
    expect(primeng).toContain('export function bindPrimeNgDarkModeToShell(): void')
  })

  it('gives the overview page a PrimeNG button and select', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const overview = readTreeFile(tree, 'apps/operations/src/overview.component.ts')
    expect(overview).toContain("import { Button } from 'primeng/button'")
    expect(overview).toContain("import { Select, type SelectChangeEvent } from 'primeng/select'")
    expect(overview).toContain('<p-select')
    expect(overview).toContain('<p-button')
    expect(overview).toContain('protected readonly user = injectUser()')
  })

  it('tells the author which overlays need an explicit appendTo, and why PrimeNG must agree across the page', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const readme = readTreeFile(tree, 'apps/operations/README.md')
    expect(readme).toContain('Dialog, ConfirmDialog and Drawer do not')
    expect(readme).toContain('[appendTo]="mount.overlayRoot"')
    expect(readme).toContain('same\n  PrimeNG version and the same preset')
    expect(readme).toContain("overrides['operations'] = 'http://localhost:3101/mf-manifest.json'")
  })

  it("exports withMfe() as the build's customWebpackConfig", async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const config = readTreeFile(tree, 'apps/operations/webpack.config.ts')
    expect(config).toContain("import { withMfe } from '@company/mfe-nx/webpack'")
    expect(config).toContain('export default withMfe()')
  })

  it('declares its configuration with env from the Angular integration', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    expect(readTreeFile(tree, 'apps/operations/src/mfe.config.ts')).toContain(
      "import { env } from '@company/mfe-nx/env'",
    )
  })

  it("builds with Nx's Angular webpack builder, from the generated entry, zoneless", async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const build = targetOf(readProjectConfiguration(tree, 'operations'), 'build')
    expect(build.executor).toBe('@nx/angular:webpack-browser')
    expect(build.dependsOn).toEqual(['generate', '^build'])
    expect(build.outputs).toEqual(['{options.outputPath}'])
    expect(build.options).toMatchObject({
      outputPath: 'dist/apps/operations',
      index: 'apps/operations/src/index.html',
      main: 'apps/operations/.mfe/entries/container.ts',
      tsConfig: 'apps/operations/tsconfig.app.json',
      polyfills: [],
      styles: [],
      customWebpackConfig: { path: 'apps/operations/webpack.config.ts' },
    })
    expect(build.defaultConfiguration).toBe('production')
  })

  it("keeps the developer's runtime-config.json out of a production build only", async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const project = readProjectConfiguration(tree, 'operations')
    expect(optionsOf(project, 'build')['assets']).toEqual([
      { glob: '**/*', input: 'apps/operations/public' },
    ])
    expect(configurationOf(project, 'build', 'production')['assets']).toEqual([
      { glob: '**/*', input: 'apps/operations/public', ignore: ['runtime-config.json'] },
    ])
    expect(configurationOf(project, 'build', 'development')).not.toHaveProperty('assets')
  })

  it('serves with the Angular dev server on its port, readable from the shell’s origin', async () => {
    await appGenerator(tree, { name: 'operations', port: 4001, skipFormat: true })

    const serve = targetOf(readProjectConfiguration(tree, 'operations'), 'serve')
    expect(serve.executor).toBe('@nx/angular:dev-server')
    expect(serve.dependsOn).toEqual(['generate'])
    expect(serve.options).toEqual({
      port: 4001,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
    expect(serve.configurations?.['development']).toEqual({
      buildTarget: 'operations:build:development',
    })
    expect(serve.defaultConfiguration).toBe('development')
  })

  it('generates first for every target that reads the generated modules', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const project = readProjectConfiguration(tree, 'operations')
    expect(targetOf(project, 'generate').executor).toBe('@company/mfe-nx:generate')
    expect(commandOf(project, 'test')).toBe('vitest run')
    expect(commandOf(project, 'typecheck')).toBe(
      'tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.spec.json',
    )
    for (const name of ['build', 'serve', 'test', 'typecheck']) {
      expect(targetOf(project, name).dependsOn, name).toContain('generate')
    }
  })

  it("gives the project its own manifest with the port, the definition's id and no scripts", async () => {
    await appGenerator(tree, { name: 'operations', port: 4001, skipFormat: true })

    const pkg = readJson<ProjectManifest>(tree, 'apps/operations/package.json')

    expect(pkg.name).toBe('@example/operations')
    expect(pkg.mfe).toEqual({ port: 4001, definitions: ['operations'] })
    expect(pkg).not.toHaveProperty('scripts')
    // An App never publishes a contract: only a Widget does.
    expect(pkg).not.toHaveProperty('exports')
  })

  it('depends on the adapter and PrimeNG, never on the neutral packages beneath the adapter', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const pkg = readJson<ProjectManifest>(tree, 'apps/operations/package.json')

    expect(pkg.dependencies).toMatchObject({
      '@angular/animations': '19.2.25',
      '@angular/cdk': '^19.2.0',
      '@angular/core': '19.2.25',
      '@angular/forms': '19.2.25',
      '@company/mfe-angular': '^0.1.0',
      '@primeng/themes': '19.1.4',
      primeng: '19.1.4',
    })
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(all).not.toHaveProperty('@company/mfe-core')
    expect(all).not.toHaveProperty('@company/mfe-runtime')
    expect(all).not.toHaveProperty('@company/mfe-host')
    expect(Object.keys(all).filter(name => /rspack/.test(name))).toEqual([])
  })

  it('builds with the Angular 19.2 builder and the @nx/angular of the running Nx', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const pkg = readJson<ProjectManifest>(tree, 'apps/operations/package.json')

    expect(pkg.devDependencies).toMatchObject({
      '@angular-devkit/build-angular': '19.2.27',
      '@angular/compiler-cli': '19.2.25',
      '@company/mfe-nx': '^0.1.0',
      '@nx/angular': '22.7.12',
      typescript: '5.8.3',
    })
  })

  it("picks the @nx/angular matching the workspace's own Nx", async () => {
    setWorkspaceDevDependency('nx', '^21.5.0')

    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const pkg = readJson<ProjectManifest>(tree, 'apps/operations/package.json')
    expect(pkg.devDependencies['@nx/angular']).toBe('^21.5.0')
  })

  it('refuses an Nx whose @nx/angular cannot build Angular 19.2, before writing anything', async () => {
    setWorkspaceDevDependency('nx', '23.2.0')

    await expect(appGenerator(tree, { name: 'operations', skipFormat: true })).rejects.toThrowError(
      /needs Nx 20, 21, 22.*nx 23\.2\.0.*@nx\/angular 23 and later require Angular 20/s,
    )
    expect(tree.exists('apps/operations/project.json')).toBe(false)
  })

  it('writes the runtime config its own #mfe/config fetches at boot', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const config = readJson<{ apiBaseUrl: string }>(
      tree,
      'apps/operations/public/runtime-config.json',
    )
    expect(config.apiBaseUrl).toMatch(/^https?:\/\//)
  })

  it('compiles for the browser with Angular decorators, whatever the workspace base targets', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const tsconfig = readTreeFile(tree, 'apps/operations/tsconfig.json')
    expect(tsconfig).toContain('"extends": "../../tsconfig.base.json"')
    expect(tsconfig).toContain('"moduleResolution": "bundler"')
    expect(tsconfig).toContain('"allowImportingTsExtensions": true')
    expect(tsconfig).toContain('"rewriteRelativeImportExtensions": true')
    expect(tsconfig).toContain('"experimentalDecorators": true')
    expect(tsconfig).toContain('"#mfe/*": ["./.mfe/*.ts"]')

    const app = readTreeFile(tree, 'apps/operations/tsconfig.app.json')
    expect(app).toContain('"include": ["src/**/*.ts", ".mfe/entries/**/*.ts", ".mfe/css.d.ts"]')
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

    const pkg = readJson<ProjectManifest>(tree, 'apps/field-ops/package.json')
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
    expect(readJson<{ name: string }>(tree, 'containers/operations/package.json').name).toBe(
      '@acme/operations',
    )
    expect(optionsOf(readProjectConfiguration(tree, 'operations'), 'build')['outputPath']).toBe(
      'dist/containers/operations',
    )
  })

  it('adds the workspace dependencies by default', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const root = readJson<ProjectManifest>(tree, 'package.json')
    expect(root.dependencies['@company/mfe-angular']).toBe('^0.1.0')
    expect(root.dependencies['primeng']).toBe('19.1.4')
    expect(root.devDependencies['@nx/angular']).toBe('22.7.12')
  })

  it('pins a workspace TypeScript Angular 19.2 cannot compile with, and says so', async () => {
    setWorkspaceDevDependency('typescript', '~6.0.3')
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    await appGenerator(tree, { name: 'operations', skipFormat: true })

    const root = readJson<ProjectManifest>(tree, 'package.json')
    expect(root.devDependencies['typescript']).toBe('5.8.3')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('from ~6.0.3 to 5.8.3')
  })

  it('leaves a workspace TypeScript Angular 19.2 accepts as it is', async () => {
    setWorkspaceDevDependency('typescript', '~5.8.3')
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    await appGenerator(tree, { name: 'operations', skipFormat: true })

    expect(readJson<ProjectManifest>(tree, 'package.json').devDependencies['typescript']).toBe(
      '~5.8.3',
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('skips the workspace package.json entirely when skipPackageJson is set', async () => {
    setWorkspaceDevDependency('typescript', '~6.0.3')

    await appGenerator(tree, { name: 'operations', skipPackageJson: true, skipFormat: true })

    const root = readJson<ProjectManifest>(tree, 'package.json')
    expect(root.dependencies).not.toHaveProperty('@company/mfe-angular')
    expect(root.devDependencies['typescript']).toBe('~6.0.3')

    // The project's own manifest still declares what it needs; only the workspace-level install
    // step is skipped.
    const pkg = readJson<ProjectManifest>(tree, 'apps/operations/package.json')
    expect(pkg.dependencies['@company/mfe-angular']).toBe('^0.1.0')
  })
})
