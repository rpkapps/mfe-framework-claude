import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'
import type { Configuration, WebpackPluginInstance } from 'webpack'

import type { DevServerMiddleware } from '@company/mfe-build'

import { cleanupContainers, createContainer } from '../testing/containers.ts'
import { MfeWebpackPlugin } from './plugin.ts'
import { withMfe } from './with-mfe.ts'

afterEach(cleanupContainers)

const WIDGET_ENTRY = `
import { createWidget } from '@company/mfe-angular'
import { z } from 'zod'

class PanelComponent {}

export const panel = createWidget({ id: 'panel', inputs: z.object({}), events: {}, component: PanelComponent })
`

class AngularOwnPlugin implements WebpackPluginInstance {
  apply(): void {}
}

const LOCAL = '{ "apiBaseUrl": "http://localhost:3010/api/" }'

/** What Angular's dev server hands over beside the webpack configuration, as far as this reads. */
interface MiddlewareEntry {
  readonly name: string
  readonly middleware: unknown
}

type ServedConfiguration = Configuration & {
  readonly devServer?: {
    readonly devMiddleware?: { readonly publicPath?: string }
    readonly setupMiddlewares?: (
      middlewares: MiddlewareEntry[],
      server: unknown,
    ) => MiddlewareEntry[]
  }
}

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

async function listen(middleware: DevServerMiddleware) {
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404
      response.end()
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, 'localhost', resolve))
  const { port } = server.address() as AddressInfo
  return (path: string) => fetch(`http://localhost:${port}${path}`)
}

describe('withMfe', () => {
  it('adds one plugin after the builder’s own and leaves the rest of the configuration alone', async () => {
    const root = createContainer({ 'src/mfe.ts': WIDGET_ENTRY })
    const own = new AngularOwnPlugin()
    const config: Configuration = {
      mode: 'production',
      entry: { main: ['./src/main.ts'] },
      output: { publicPath: '' },
      plugins: [own],
    }

    const result = await withMfe({ containerRoot: root })(config)

    expect(result.plugins).toHaveLength(2)
    expect(result.plugins?.[0]).toBe(own)
    expect(result.plugins?.[1]).toBeInstanceOf(MfeWebpackPlugin)
    expect(result.entry).toBe(config.entry)
    expect(result.output).toBe(config.output)
    expect(result).not.toHaveProperty('devServer')
    // The builder's own object is never modified in place.
    expect(config.plugins).toEqual([own])
  })

  it("serves the developer's runtime configuration in Angular's dev server, ahead of the compiled output", async () => {
    const root = createContainer({
      'src/mfe.ts': WIDGET_ENTRY,
      '.mfe/runtime-config.json': LOCAL,
    })
    const authored = { name: 'authored', middleware: () => {} }
    const config: ServedConfiguration = {
      mode: 'development',
      plugins: [],
      devServer: {
        devMiddleware: { publicPath: '/ops/' },
        setupMiddlewares: middlewares => [...middlewares, authored],
      },
    }

    const result = (await withMfe({ containerRoot: root })(config)) as ServedConfiguration
    const middlewares = result.devServer?.setupMiddlewares?.(
      ['host-header-check', 'set-headers', 'webpack-dev-middleware', 'express-static'].map(
        name => ({ name, middleware: () => {} }),
      ),
      {},
    )

    expect(middlewares?.map(entry => entry.name)).toEqual([
      'host-header-check',
      'set-headers',
      'mfe-local-runtime-config',
      'webpack-dev-middleware',
      'express-static',
      'authored',
    ])
    const served = middlewares?.find(entry => entry.name === 'mfe-local-runtime-config')
    const request = await listen(served?.middleware as DevServerMiddleware)
    expect(await (await request('/ops/runtime-config.json')).text()).toBe(LOCAL)
  })

  it('names the option to set when there is neither a container root nor an Nx target', async () => {
    await expect(withMfe()({ plugins: [] })).rejects.toThrowError(
      /find the container this webpack configuration builds.*no target.*withMfe\(\{ containerRoot \}\)/s,
    )
  })
})
