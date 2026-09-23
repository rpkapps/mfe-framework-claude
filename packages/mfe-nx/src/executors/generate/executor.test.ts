import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { logger, type ExecutorContext } from '@nx/devkit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cleanupContainers, createContainer, writeFile } from '../../testing/containers.ts'
import generateExecutor, { generate } from './executor.ts'

afterEach(() => {
  cleanupContainers()
  vi.restoreAllMocks()
})

const APP_ENTRY = `
import { createApp } from '@company/mfe-angular'

export default createApp({ id: 'reports', routes: [] })
`

const CONFIG = `
import { env } from '@company/mfe-nx/env'
import { z } from 'zod'

export default {
  apiBaseUrl: env('API_BASE_URL', z.string().url(), { api: true }),
  reportLimit: env('REPORT_LIMIT', z.number().default(20)),
}
`

/** The context Nx hands the executor for `nx run reports:generate` in a workspace at `root`'s parent. */
function contextFor(containerRoot: string, projectName = 'reports'): ExecutorContext {
  const root = dirname(containerRoot)
  return {
    root,
    cwd: root,
    isVerbose: false,
    projectName,
    projectsConfigurations: {
      version: 2,
      projects: { reports: { root: basename(containerRoot) } },
    },
    nxJsonConfiguration: {},
    projectGraph: { nodes: {}, dependencies: {} },
  }
}

function silenceLogger() {
  return {
    info: vi.spyOn(logger, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(logger, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(logger, 'error').mockImplementation(() => {}),
  }
}

describe('generate', () => {
  it('writes the generated modules the container imports as #mfe/*', () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY })

    const result = generate(root)

    expect(result.packageName).toBe('@acme/reports')
    expect(result.paths).toEqual(expect.arrayContaining(['.mfe/fetch.ts', '.mfe/meta.ts']))
    expect(existsSync(join(root, '.mfe/entries/app.ts'))).toBe(true)
    expect(result.diagnostics).toEqual([])
  })

  it('writes nothing the second time, when the sources are unchanged', () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY })
    generate(root)

    expect(generate(root).paths).toEqual([])
  })

  it("adds the declared defaults to the developer's runtime config and notes what has none", () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })

    const result = generate(root)

    expect(result.paths).toContain('.mfe/runtime-config.json')
    expect(JSON.parse(readFileSync(join(root, '.mfe/runtime-config.json'), 'utf8'))).toEqual({
      reportLimit: 20,
    })
    expect(result.notes).toEqual([
      expect.stringContaining('has no value for apiBaseUrl (API_BASE_URL'),
    ])
  })

  it('moves a copy left in public/ into .mfe/ and says so, once', () => {
    const local = '{"apiBaseUrl":"http://localhost:3010/api/","reportLimit":5}'
    const root = createContainer({
      'src/mfe.ts': APP_ENTRY,
      'src/mfe.config.ts': CONFIG,
      'public/runtime-config.json': local,
    })

    const result = generate(root)

    expect(existsSync(join(root, 'public/runtime-config.json'))).toBe(false)
    expect(readFileSync(join(root, '.mfe/runtime-config.json'), 'utf8')).toBe(local)
    expect(result.notes).toEqual([
      expect.stringContaining(
        'Moved public/runtime-config.json to .mfe/runtime-config.json, where the dev server now reads it',
      ),
    ])
    expect(generate(root).notes).toEqual([])
  })

  it('never rewrites or removes the developer’s copy when it regenerates .mfe/', () => {
    const local = '{ "apiBaseUrl": "http://localhost:3010/api/", "reportLimit": 5 }'
    const root = createContainer({
      'src/mfe.ts': APP_ENTRY,
      'src/mfe.config.ts': CONFIG,
      '.mfe/runtime-config.json': local,
    })

    generate(root)
    writeFile(
      root,
      'src/mfe.ts',
      APP_ENTRY.replace("id: 'reports'", "id: 'reports', version: '2.0.0'"),
    )
    generate(root)

    expect(readFileSync(join(root, '.mfe/runtime-config.json'), 'utf8')).toBe(local)
  })
})

describe('the generate executor', () => {
  it('generates for the project it runs as a target of, and says what it wrote', async () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY })
    const log = silenceLogger()

    const result = await generateExecutor({}, contextFor(root))

    expect(result).toEqual({ success: true })
    expect(existsSync(join(root, '.mfe/meta.ts'))).toBe(true)
    expect(log.info).toHaveBeenCalledTimes(1)
    expect(log.info.mock.calls[0]?.[0]).toContain('@acme/reports\n  .mfe/')
    expect(log.error).not.toHaveBeenCalled()
  })

  it("fails on a finding in the container's sources, which nothing else reports before a build", async () => {
    const root = createContainer({
      'src/mfe.ts': APP_ENTRY,
      'src/stray.ts': `
import { createApp } from '@company/mfe-angular'
export const stray = createApp({ id: 'stray', routes: [] })
`,
    })
    const log = silenceLogger()

    const result = await generateExecutor({}, contextFor(root))

    expect(result).toEqual({ success: false })
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0]?.[0]).toContain('src/stray.ts')
  })

  it('fails with the build error when the container cannot be read', async () => {
    const root = createContainer({ 'src/other.ts': 'export {}\n' })
    const log = silenceLogger()

    const result = await generateExecutor({}, contextFor(root))

    expect(result).toEqual({ success: false })
    expect(log.error.mock.calls[0]?.[0]).toContain('find the container entry module')
  })

  it('fails naming the command to run when it is not a project target', async () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY })
    const log = silenceLogger()

    const result = await generateExecutor({}, contextFor(root, 'missing'))

    expect(result).toEqual({ success: false })
    expect(log.error.mock.calls[0]?.[0]).toContain('nx run <project>:generate')
  })
})
