/**
 * Rsbuild's own dev server, with `pluginMfe()` applied and nothing compiled: what answers the
 * runtime configuration's URL is decided by the order of its middlewares, not by the build.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { createRsbuild, type RsbuildConfig } from '@rsbuild/core'
import { afterEach, describe, expect, it } from 'vitest'

import type { MfePluginOptions } from './options.ts'
import { pluginMfe } from './rsbuild.ts'
import { cleanupContainers, createContainer } from './testing/fixtures.ts'

const WIDGET_ENTRY = `
import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

export const orderRow = createWidget({
  id: 'order-row',
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({}),
  render: () => null,
})
`

const LOCAL = '{ "apiBaseUrl": "http://localhost:3010/api/" }'

const closers: (() => Promise<unknown>)[] = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
  cleanupContainers()
})

async function devServerFor(
  files: Readonly<Record<string, string>>,
  options: MfePluginOptions = {},
  config: RsbuildConfig = {},
) {
  const root = createContainer({ 'src/mfe.ts': WIDGET_ENTRY, ...files })
  const rsbuild = await createRsbuild({
    cwd: root,
    rsbuildConfig: {
      ...config,
      plugins: [pluginMfe(options)],
      server: { printUrls: false, ...config.server },
    },
  })
  const devServer = await rsbuild.createDevServer({ runCompile: false, getPortSilently: true })
  const server: Server = createServer(devServer.middlewares)
  closers.push(
    () => devServer.close(),
    () => new Promise(resolve => server.close(resolve)),
  )

  await new Promise<void>(resolve => server.listen(0, 'localhost', resolve))
  const { port } = server.address() as AddressInfo
  return (path: string) => fetch(`http://localhost:${port}${path}`)
}

describe('pluginMfe in the dev server', () => {
  it("answers runtime-config.json with the developer's copy in .mfe/, over one left in public/", async () => {
    const request = await devServerFor({
      '.mfe/runtime-config.json': LOCAL,
      'public/runtime-config.json': '{ "apiBaseUrl": "https://stale.example.test/" }',
      'public/robots.txt': 'User-agent: *\n',
    })

    const response = await request('/runtime-config.json')

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.text()).toBe(LOCAL)
    // The rest of public/ is served as it always was.
    expect(await (await request('/robots.txt')).text()).toBe('User-agent: *\n')
  })

  it('serves a renamed file at its own name, under the server base', async () => {
    const request = await devServerFor(
      { '.mfe/settings.json': LOCAL },
      { runtimeConfigFileName: 'settings.json' },
      { server: { base: '/ops' } },
    )

    expect(await (await request('/ops/settings.json')).text()).toBe(LOCAL)
    expect((await request('/ops/runtime-config.json')).status).toBe(404)
  })
})
