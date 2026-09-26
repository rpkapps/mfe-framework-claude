import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { idFromDirectory, main, scaffold } from './cli.ts'
import { appTemplate } from './templates/app.ts'
import { safeIdentifier, widgetTemplate } from './templates/widget.ts'

/** What compiling a module without its dependencies reports whatever the module says. */
const UNRESOLVED: ReadonlySet<number> = new Set([
  2307, // Cannot find module
  2875, // The JSX runtime module cannot be found
  7026, // No JSX.IntrinsicElements, which React's types would declare
])

const created: string[] = []

/** A pnpm workspace with the shape the starters join: package globs and a base tsconfig. */
async function workspace(globs: readonly string[] = ['examples/*']): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mfe-scaffold-'))
  created.push(root)
  const packages = globs.map(glob => `  - '${glob}'`).join('\n')
  await writeFile(join(root, 'pnpm-workspace.yaml'), `packages:\n${packages}\n`, 'utf8')
  await writeFile(join(root, 'tsconfig.base.json'), '{}\n', 'utf8')
  return root
}

/** A directory inside a fresh workspace that its package globs match. */
async function target(): Promise<string> {
  return join(await workspace(), 'examples', 'container')
}

const OPTIONS = { tsconfigBase: '../../tsconfig.base.json' } as const

afterEach(async () => {
  await Promise.all(
    created.splice(0).map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('the App starter', () => {
  it('writes the router bootstrap, the augmentation and a marked capability route', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'operations', template: 'app', force: true })

    const entry = await readFile(join(directory, 'src/mfe.ts'), 'utf8')
    expect(entry).toContain("id: 'operations'")
    expect(entry).toContain('basepath: basePath')
    expect(entry).toContain('history,')
    expect(entry).toContain('context: { ...context }')
    expect(entry).toContain("declare module '@tanstack/react-router'")
    // Types `staticData` with what the framework reads out of it, so the capability
    // below is checked against the same shape the build extracts.
    expect(entry).toContain('interface StaticDataRouteOption extends MfeStaticData {}')

    const settings = await readFile(join(directory, 'src/routes/settings.tsx'), 'utf8')
    expect(settings).toContain("name: 'settings'")
  })

  it('provides every documented script', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'operations', template: 'app', force: true })

    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    for (const script of ['dev', 'generate', 'typecheck', 'test', 'build', 'lint', 'format']) {
      expect(manifest.scripts[script], script).toBeDefined()
    }
  })

  it('runs an Rsbuild container, matching the example containers', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'operations', template: 'app', force: true })

    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }

    // The scaffolded rsbuild.config.ts is an Rsbuild config, so its scripts and
    // dependencies must be Rsbuild's, not Rspack's raw CLI.
    expect(manifest.scripts['dev']).toBe('pnpm run generate && rsbuild dev')
    expect(manifest.scripts['build']).toBe('pnpm run generate && rsbuild build')
    expect(manifest.devDependencies['@rsbuild/core']).toBe('catalog:')
    expect(manifest.devDependencies['@rsbuild/plugin-react']).toBe('catalog:')
    expect(manifest.devDependencies).not.toHaveProperty('@rspack/cli')
    expect(manifest.devDependencies).not.toHaveProperty('@rspack/core')
    expect(manifest.devDependencies).not.toHaveProperty('@rspack/dev-server')
  })

  it('lints against the React preset and installs its peers', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'operations', template: 'app', force: true })

    const eslintConfig = await readFile(join(directory, 'eslint.config.ts'), 'utf8')
    expect(eslintConfig).toContain("import react from '@company/eslint-plugin-mfe/react'")
    expect(eslintConfig).toContain('react.author(')
    expect(eslintConfig).not.toContain('mfe.author(')

    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
    }
    expect(manifest.devDependencies['eslint-plugin-react-hooks']).toBe('catalog:')
    expect(manifest.devDependencies['@tanstack/eslint-plugin-query']).toBe('catalog:')
    expect(manifest.devDependencies['@tanstack/eslint-plugin-router']).toBe('catalog:')
  })

  it('installs the Tailwind the generated stylesheet imports', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'operations', template: 'app', force: true })

    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
    }

    expect(manifest.devDependencies['tailwindcss']).toBe('catalog:')
  })

  it('writes the runtime config its own #mfe/config fetches at boot', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'operations', template: 'app', force: true })

    const config = JSON.parse(
      await readFile(join(directory, '.mfe/runtime-config.json'), 'utf8'),
    ) as { apiBaseUrl: string }

    // src/mfe.config.ts declares apiBaseUrl as a required URL: without this file
    // a scaffolded App fails at boot with config/missing.
    expect(config.apiBaseUrl).toMatch(/^https?:\/\//)
  })

  it('does not check in generated output', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'operations', template: 'app', force: true })

    const ignored = (await readFile(join(directory, '.gitignore'), 'utf8')).split('\n')
    expect(ignored).toContain('routeTree.gen.ts')
    // The directory's contents rather than the directory, or the exception could never apply.
    expect(ignored).toContain('.mfe/*')
    expect(ignored).not.toContain('.mfe/')
    expect(ignored).toContain('!.mfe/runtime-config.json')

    const files = await readdir(join(directory, 'src'))
    expect(files).not.toContain('routeTree.gen.ts')
  })

  it('ignores no local-values file, because nothing reads one', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'operations', template: 'app', force: true })

    // `#mfe/config` fetches runtime-config.json from the container's public path and
    // nowhere else, and the dev server answers it with `.mfe/runtime-config.json`, so a
    // gitignored `.local.json` or `.env` would only mislead.
    const ignored = await readFile(join(directory, '.gitignore'), 'utf8')
    expect(ignored).not.toContain('runtime-config.local.json')
    expect(ignored).not.toContain('.env')

    const files = appTemplate({ id: 'operations', packageName: '@example/operations', ...OPTIONS })
    expect(files.some(file => file.path === 'runtime-config.example.json')).toBe(false)

    const readme = await readFile(join(directory, 'README.md'), 'utf8')
    expect(readme).toContain('.mfe/runtime-config.json')
    expect(readme).not.toContain('public/runtime-config.json')
    expect(readme).not.toContain('runtime-config.example.json')
  })

  it('ships a component test that needs no shell and no credentials', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'operations', template: 'app', force: true })

    const test = await readFile(join(directory, 'src/routes/index.test.tsx'), 'utf8')
    expect(test).toContain('@company/mfe-react/testing')
    expect(test).toContain('dispose()')
  })
})

describe('the Widget starter', () => {
  it('exports the contract separately so a consumer can import it', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'alert-panel', template: 'widget', force: true })

    const entry = await readFile(join(directory, 'src/mfe.ts'), 'utf8')
    expect(entry).toContain('export const alertPanelContract')
    expect(entry).toContain("id: 'alert-panel'")
    expect(entry).toContain('...alertPanelContract')
  })

  it('puts the render in its own module, so editing it hot-updates', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'alert-panel', template: 'widget', force: true })

    const entry = await readFile(join(directory, 'src/mfe.ts'), 'utf8')
    expect(entry).toContain("import { AlertPanel } from './alert-panel.tsx'")
    expect(entry).toContain('render: AlertPanel')
    expect(entry).not.toContain('<button')

    const render = await readFile(join(directory, 'src/alert-panel.tsx'), 'utf8')
    expect(render).toContain('export function AlertPanel')
  })

  it('declares no routes and no base path', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'alert-panel', template: 'widget', force: true })

    const files = widgetTemplate({
      id: 'alert-panel',
      packageName: '@example/alert-panel',
      ...OPTIONS,
    })
    expect(files.some(file => file.path.startsWith('src/routes/'))).toBe(false)

    const entry = await readFile(join(directory, 'src/mfe.ts'), 'utf8')
    expect(entry).not.toContain('basePath')
    expect(entry).not.toContain('createRouter')
  })

  it('runs an Rsbuild container, matching the example containers', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'alert-panel', template: 'widget', force: true })

    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }

    expect(manifest.scripts['dev']).toBe('pnpm run generate && rsbuild dev')
    expect(manifest.scripts['build']).toBe('pnpm run generate && rsbuild build')
    expect(manifest.devDependencies['@rsbuild/core']).toBe('catalog:')
    expect(manifest.devDependencies['@rsbuild/plugin-react']).toBe('catalog:')
    expect(manifest.devDependencies).not.toHaveProperty('@rspack/cli')
    expect(manifest.devDependencies).not.toHaveProperty('@rspack/core')
    expect(manifest.devDependencies).not.toHaveProperty('@rspack/dev-server')
  })

  it('publishes the generated contract module, matching how it is actually generated', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'alert-panel', template: 'widget', force: true })

    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
      exports: Record<string, string>
    }
    // The build reads `src/mfe.ts` and emits this exact path, exporting `inputSchema`
    // and `outputSchema` — never a `<camel>Contract` object (that name only exists in
    // this container's own entry, not in what the build publishes).
    expect(manifest.exports['./contracts']).toBe('./.mfe/widgets/alert-panel.contract.ts')

    const readme = await readFile(join(directory, 'README.md'), 'utf8')
    expect(readme).toContain(
      "import { inputSchema, outputSchema } from '@example/alert-panel/contracts'",
    )
    expect(readme).toContain('contract: { inputSchema, outputSchema }')
    expect(readme).not.toContain('alertPanelContract')
  })

  it('writes no public/ directory: a Widget has no #mfe/config to fetch it for', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'alert-panel', template: 'widget', force: true })

    const files = widgetTemplate({
      id: 'alert-panel',
      packageName: '@example/alert-panel',
      ...OPTIONS,
    })
    expect(files.some(file => file.path.startsWith('public/'))).toBe(false)
  })
})

describe('scaffold behaviour', () => {
  it('rejects an id that cannot serve as a storage prefix and a scope value', async () => {
    const directory = await target()

    await expect(
      scaffold({ directory, id: 'Alert Panel', template: 'app', force: true }),
    ).rejects.toThrowError(/not a usable definition id.*storage prefix.*CSS scope value/s)
  })

  it('refuses a non-empty directory unless forced', async () => {
    const directory = await target()
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'existing.txt'), 'keep me', 'utf8')

    await expect(scaffold({ directory, id: 'operations', template: 'app' })).rejects.toThrowError(
      /is not empty.*--force/s,
    )
  })

  it('is deterministic: a second generation produces identical files', async () => {
    const first = await target()
    const second = await target()

    await scaffold({ directory: first, id: 'operations', template: 'app', force: true })
    await scaffold({ directory: second, id: 'operations', template: 'app', force: true })

    const files = appTemplate({ id: 'operations', packageName: '@example/operations', ...OPTIONS })
    for (const file of files) {
      const a = await readFile(join(first, file.path), 'utf8')
      const b = await readFile(join(second, file.path), 'utf8')
      expect(b, file.path).toBe(a)
    }
  })

  it('names the package after the id so the two cannot drift', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'alert-panel', template: 'widget', force: true })

    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
      name: string
      mfe: { definitions: string[] }
    }

    expect(manifest.name).toBe('@example/alert-panel')
    expect(manifest.mfe.definitions).toEqual(['alert-panel'])
  })
})

describe('placing a project in its workspace', () => {
  async function extendsOf(directory: string): Promise<string> {
    const tsconfig = await readFile(join(directory, 'tsconfig.json'), 'utf8')
    return /"extends": "([^"]+)"/.exec(tsconfig)?.[1] ?? ''
  }

  it('extends the base tsconfig of the workspace it joins, however deep', async () => {
    const root = await workspace(['examples/*', 'teams/**'])
    const shallow = join(root, 'examples', 'reports')
    const deep = join(root, 'teams', 'finance', 'reports')

    await scaffold({ directory: shallow, id: 'reports', template: 'app' })
    await scaffold({ directory: deep, id: 'reports', template: 'widget' })

    expect(await extendsOf(shallow)).toBe('../../tsconfig.base.json')
    expect(await extendsOf(deep)).toBe('../../../tsconfig.base.json')
  })

  it('refuses a directory the package globs do not match, and writes nothing', async () => {
    const root = await workspace(['examples/*', '!examples/private'])
    const outside = join(root, 'elsewhere', 'reports')
    const excluded = join(root, 'examples', 'private')

    await expect(scaffold({ directory: outside, id: 'reports', template: 'app' })).rejects.toThrow(
      /elsewhere\/reports\) matches no package glob.*examples\/\*, !examples\/private/s,
    )
    await expect(scaffold({ directory: excluded, id: 'reports', template: 'app' })).rejects.toThrow(
      /matches no package glob/,
    )
    await expect(scaffold({ directory: root, id: 'reports', template: 'app' })).rejects.toThrow(
      /is the root of the pnpm workspace/,
    )
    expect((await readdir(root)).sort()).toEqual(['pnpm-workspace.yaml', 'tsconfig.base.json'])
  })

  it('refuses a directory outside any pnpm workspace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mfe-scaffold-'))
    created.push(directory)

    await expect(scaffold({ directory, id: 'reports', template: 'app' })).rejects.toThrow(
      /is not inside a pnpm workspace.*pnpm-workspace\.yaml/s,
    )
  })
})

describe('the command', () => {
  it('names the definition after the directory, whatever path spells it', async () => {
    const root = await workspace()
    const directory = join(root, 'examples', 'alert-panel')
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      expect(await main([`${directory}${sep}`, '--template', 'widget'])).toBe(0)
    } finally {
      log.mockRestore()
    }

    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
      mfe: { definitions: string[] }
    }
    expect(manifest.mfe.definitions).toEqual(['alert-panel'])
    expect(idFromDirectory('.')).toBe(basename(process.cwd()))
    expect(idFromDirectory(join(directory, 'src', '..'))).toBe('alert-panel')
  })

  it('runs through a symlinked bin, as an installed package links it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mfe-bin-'))
    created.push(directory)
    const bin = join(directory, 'create-mfe')
    await symlink(fileURLToPath(new URL('./cli.ts', import.meta.url)), bin)

    const result = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('pnpm create @company/mfe')
  })
})

describe('the Widget starter’s identifiers', () => {
  /** The lib files are the same for every id, and parsing them is most of what a case costs. */
  const libraries = new Map<string, ts.SourceFile>()

  /**
   * Every generated module, compiled together without its dependencies: a module that cannot be
   * resolved is `any`, so what is left is what the template itself got wrong — a keyword or a
   * digit where an identifier goes, or a name declared twice.
   */
  function diagnosticsFor(id: string): string[] {
    const files = new Map(
      widgetTemplate({ id, packageName: `@example/${id}`, ...OPTIONS })
        .filter(file => file.path.startsWith('src/') && /\.tsx?$/.test(file.path))
        .map(file => [`/project/${file.path}`, file.contents]),
    )
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      jsx: ts.JsxEmit.Preserve,
      noEmit: true,
      strict: true,
      lib: ['lib.es2023.d.ts'],
      types: [],
    }
    const host = ts.createCompilerHost(options)
    const disk = { ...host }
    host.fileExists = path => files.has(path) || disk.fileExists(path)
    host.readFile = path => files.get(path) ?? disk.readFile(path)
    host.getSourceFile = (path, languageVersion, ...rest) => {
      const contents = files.get(path)
      if (contents !== undefined) return ts.createSourceFile(path, contents, languageVersion, true)
      let lib = libraries.get(path)
      if (lib === undefined) {
        lib = disk.getSourceFile(path, languageVersion, ...rest)
        if (lib !== undefined) libraries.set(path, lib)
      }
      return lib
    }
    const program = ts.createProgram([...files.keys()], options, host)
    return ts
      .getPreEmitDiagnostics(program)
      .filter(diagnostic => !UNRESOLVED.has(diagnostic.code))
      .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  }

  it.each(['3d-viewer', 'new', 'class', 'create-widget', 'z', 'user-event', 'date', 'alert-panel'])(
    'generates modules that compile for the id %s',
    id => {
      expect(diagnosticsFor(id)).toEqual([])
    },
  )

  it('keeps the readable name when it is safe, and adjusts it only when it is not', () => {
    expect(safeIdentifier('alertPanel', 'widget')).toBe('alertPanel')
    expect(safeIdentifier('3dViewer', 'widget')).toBe('widget3dViewer')
    expect(safeIdentifier('new', 'widget')).toBe('newWidget')
    expect(safeIdentifier('createWidget', 'widget')).toBe('createWidgetWidget')
  })
})
