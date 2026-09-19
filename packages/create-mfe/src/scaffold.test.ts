import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { scaffold } from './cli.ts'
import { appTemplate } from './templates/app.ts'
import { widgetTemplate } from './templates/widget.ts'

const created: string[] = []

async function target(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mfe-scaffold-'))
  created.push(directory)
  return directory
}

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
    // The augmentation is written for the author rather than left as an exercise.
    expect(entry).toContain("declare module '@tanstack/react-router'")

    const settings = await readFile(join(directory, 'src/routes/settings.tsx'), 'utf8')
    expect(settings).toContain("capability: 'settings'")
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

  it('does not check in generated output', async () => {
    const directory = await target()
    await scaffold({ directory, id: 'operations', template: 'app', force: true })

    const ignored = await readFile(join(directory, '.gitignore'), 'utf8')
    expect(ignored).toContain('routeTree.gen.ts')
    expect(ignored).toContain('.mfe/')

    const files = await readdir(join(directory, 'src'))
    expect(files).not.toContain('routeTree.gen.ts')
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

  /**
   * React Refresh replaces a module only when every export is a component, and
   * an entry exports a definition and a contract. A starter that writes the
   * render inline would reload the whole page on every edit to it.
   */
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

    const files = widgetTemplate({ id: 'alert-panel', packageName: '@example/alert-panel' })
    expect(files.some(file => file.path.startsWith('src/routes/'))).toBe(false)

    const entry = await readFile(join(directory, 'src/mfe.ts'), 'utf8')
    expect(entry).not.toContain('basePath')
    expect(entry).not.toContain('createRouter')
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

    const files = appTemplate({ id: 'operations', packageName: '@example/operations' })
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
